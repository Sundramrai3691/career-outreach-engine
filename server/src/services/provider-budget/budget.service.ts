import { PrismaClient } from '@prisma/client';
import { ProviderName } from '../../models/types.js';
import { logger } from '../../utils/logger.js';

export interface BudgetEstimate {
  estimatedCostMin: number;
  estimatedCostMax: number;
  canProceed: boolean;
  warnings: string[];
}

export class BudgetService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Estimates maximum credit cost for a planned discovery run
   */
  async estimateRunCost(
    companiesCount: number,
    rolesCount: number,
    allowEnrichment: boolean,
    freeFirstMode: boolean,
    verifyEmails: boolean,
    maxBudget?: number
  ): Promise<BudgetEstimate> {
    const warnings: string[] = [];

    if (freeFirstMode && !allowEnrichment) {
      return {
        estimatedCostMin: 0,
        estimatedCostMax: 0,
        canProceed: true,
        warnings: [],
      };
    }

    // Expected contacts per company: ~3-5 matches
    const estimatedProfiles = companiesCount * Math.max(1, rolesCount) * 2;

    // In Apollo, enrichment costs 1 credit per contact with verified email
    // In Hunter, email finder costs 1 credit, verification costs 1 credit
    let costPerContact = 0;
    if (allowEnrichment) costPerContact += 1; // Apollo bulk match
    if (verifyEmails) costPerContact += 0.5; // Hunter verifier when uncertain

    const estimatedCostMin = Math.round(companiesCount * 0.5);
    const estimatedCostMax = Math.round(estimatedProfiles * costPerContact);

    let canProceed = true;
    if (maxBudget !== undefined && maxBudget > 0 && estimatedCostMin > maxBudget) {
      warnings.push(
        `Estimated minimum cost (${estimatedCostMin} credits) exceeds your configured run budget cap (${maxBudget} credits).`
      );
      canProceed = false;
    }

    return {
      estimatedCostMin,
      estimatedCostMax,
      canProceed,
      warnings,
    };
  }

  /**
   * Verifies if a provider has remaining budget within user spending cap
   */
  async canSpend(provider: ProviderName, cost = 1, currentRunCredits = 0, runBudgetCap?: number): Promise<boolean> {
    if (runBudgetCap !== undefined && runBudgetCap > 0) {
      if (currentRunCredits + cost > runBudgetCap) {
        logger.warn(`Run budget cap reached (${currentRunCredits}/${runBudgetCap}). Halting paid operations.`);
        return false;
      }
    }

    const setting = await this.prisma.providerSetting.findUnique({
      where: { providerKey: provider },
    });

    if (!setting) return true;

    if (!setting.isEnabled) {
      return false;
    }

    if (setting.spendingCap !== null && setting.spendingCap !== undefined) {
      if (setting.creditsUsed + cost > setting.spendingCap) {
        logger.warn(`Provider ${provider} spending cap exceeded (${setting.creditsUsed}/${setting.spendingCap}).`);
        return false;
      }
    }

    return true;
  }

  /**
   * Records credits spent by a provider
   */
  async recordUsage(provider: ProviderName, creditsSpent: number): Promise<void> {
    if (creditsSpent <= 0) return;

    try {
      await this.prisma.providerSetting.upsert({
        where: { providerKey: provider },
        update: {
          creditsUsed: { increment: creditsSpent },
        },
        create: {
          providerKey: provider,
          creditsUsed: creditsSpent,
        },
      });
    } catch (err) {
      logger.error('Failed to record provider credit usage in database', err);
    }
  }
}
