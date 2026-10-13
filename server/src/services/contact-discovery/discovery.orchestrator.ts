import { PrismaClient } from '@prisma/client';
import {
  CompanyTargetInput,
  DiscoveryRunConfig,
  ProviderName,
  DiscoveredPersonProfile,
  EmailVerificationStatus,
} from '../../models/types.js';
import { IContactProvider } from '../../providers/base.provider.js';
import { ApolloProvider } from '../../providers/apollo/apollo.provider.js';
import { HunterProvider } from '../../providers/hunter/hunter.provider.js';
import { SnovProvider } from '../../providers/snov/snov.provider.js';
import { MockProvider } from '../../providers/mock/mock.provider.js';
import { NormalizerService } from '../normalizer.service.js';
import { BudgetService } from '../provider-budget/budget.service.js';
import { EmailVerificationService } from '../email-verification/verifier.service.js';
import { logger } from '../../utils/logger.js';

export class DiscoveryOrchestrator {
  private providers: Map<ProviderName, IContactProvider> = new Map();
  private budgetService: BudgetService;
  private verificationService: EmailVerificationService;
  private cancelledRuns: Set<string> = new Set();

  constructor(
    private prisma: PrismaClient,
    customProviders?: Map<ProviderName, IContactProvider>
  ) {
    this.budgetService = new BudgetService(this.prisma);
    const hunter = new HunterProvider();
    this.verificationService = new EmailVerificationService(hunter);

    if (customProviders) {
      this.providers = customProviders;
    } else {
      this.providers.set('apollo', new ApolloProvider());
      this.providers.set('hunter', hunter);
      this.providers.set('snov', new SnovProvider());
      this.providers.set('mock', new MockProvider());
    }
  }

  cancelRun(runId: string) {
    this.cancelledRuns.add(runId);
  }

  /**
   * Initializes and executes a full persistent discovery run
   */
  async startDiscovery(
    companies: CompanyTargetInput[],
    config: DiscoveryRunConfig
  ): Promise<string> {
    // 1. Create persistent DiscoveryRun record
    const run = await this.prisma.discoveryRun.create({
      data: {
        status: 'running',
        totalCompanies: companies.length,
        processedCompanies: 0,
        contactsFound: 0,
        creditsConsumed: 0.0,
        maxBudget: config.maxBudget,
        allowEnrichment: config.allowEnrichment,
        freeFirstMode: config.freeFirstMode,
        verifyEmails: config.verifyEmails,
        startedAt: new Date(),
      },
    });

    // 2. Create DiscoveryRunItems for each company
    for (const target of companies) {
      const normalizedDomain = NormalizerService.normalizeDomain(target.domain);
      const cleanName = NormalizerService.normalizeCompanyName(target.name);

      // Upsert company
      const companyRecord = await this.prisma.company.upsert({
        where: normalizedDomain ? { domain: normalizedDomain } : { id: 'placeholder-company-id' },
        update: {
          name: cleanName,
          location: target.location || undefined,
          jobUrl: target.jobUrl || undefined,
          notes: target.notes || undefined,
        },
        create: {
          name: cleanName,
          domain: normalizedDomain,
          normalizedDomain,
          location: target.location,
          jobUrl: target.jobUrl,
          notes: target.notes,
        },
      });

      await this.prisma.discoveryRunItem.create({
        data: {
          discoveryRunId: run.id,
          companyId: companyRecord.id,
          companyName: cleanName,
          companyDomain: normalizedDomain,
          targetRolesJson: JSON.stringify(target.targetRoles),
          status: 'waiting',
          providersTriedJson: JSON.stringify([]),
        },
      });
    }

    // 3. Kick off async execution (background worker loop)
    this.executeRun(run.id, config).catch((err) => {
      logger.error(`Discovery run ${run.id} failed uncaught`, err);
    });

    return run.id;
  }

  /**
   * Main asynchronous execution loop with bounded concurrency & waterfall fallback
   */
  private async executeRun(runId: string, config: DiscoveryRunConfig): Promise<void> {
    const run = await this.prisma.discoveryRun.findUnique({
      where: { id: runId },
      include: { items: true },
    });

    if (!run) return;

    let totalDiscoveredContacts = 0;
    let totalCreditsSpent = 0;
    const providerPriority = config.providerPriority || ['apollo', 'hunter', 'snov'];

    for (const item of run.items) {
      if (this.cancelledRuns.has(runId)) {
        await this.prisma.discoveryRun.update({
          where: { id: runId },
          data: { status: 'cancelled' },
        });
        return;
      }

      const targetRoles: string[] = JSON.parse(item.targetRolesJson);
      const providersTried: ProviderName[] = [];

      try {
        // Stage A: Resolve Company & Domain
        await this.prisma.discoveryRunItem.update({
          where: { id: item.id },
          data: { status: 'resolving_company' },
        });

        let domain = item.companyDomain;
        if (!domain) {
          // If no domain provided, derive simple domain fallback or skip
          domain = `${item.companyName.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`;
        }

        // Stage B & C: Waterfall Execution
        await this.prisma.discoveryRunItem.update({
          where: { id: item.id },
          data: { status: 'searching_contacts' },
        });

        const candidates: DiscoveredPersonProfile[] = [];

        for (const providerKey of providerPriority) {
          const provider = this.providers.get(providerKey);
          if (!provider) continue;

          providersTried.push(providerKey);

          // Check if provider can execute Stage B (People Search)
          if (providerKey === 'apollo' || providerKey === 'mock') {
            const people = await provider.searchPeople(domain, targetRoles);

            if (people.length > 0) {
              await this.prisma.discoveryRunItem.update({
                where: { id: item.id },
                data: { status: 'finding_emails' },
              });

              for (const person of people) {
                // Check role match
                const match = NormalizerService.matchTargetRole(person.title, targetRoles);
                if (!match.isMatch && targetRoles.length > 0) continue;

                let directEmail: string | undefined;
                let emailStatus: EmailVerificationStatus = 'unverified';
                let confidence = 80;

                // If user allows enrichment and budget permits, enrich via Apollo
                const canEnrich =
                  config.allowEnrichment &&
                  (await this.budgetService.canSpend('apollo', 1, totalCreditsSpent, config.maxBudget));

                if (canEnrich) {
                  const enrichResult = await provider.enrichPerson({
                    id: person.providerPersonId,
                    firstName: person.firstName,
                    lastName: person.lastName,
                    domain,
                    organizationName: item.companyName,
                  });

                  if (enrichResult.success && enrichResult.email) {
                    directEmail = enrichResult.email;
                    emailStatus = enrichResult.emailStatus || 'verified';
                    confidence = 95;
                    totalCreditsSpent += enrichResult.creditsConsumed || 1;
                    await this.budgetService.recordUsage('apollo', enrichResult.creditsConsumed || 1);
                  }
                }

                // If no email from Apollo, try Hunter Email Finder fallback
                if (!directEmail && this.providers.has('hunter') && person.firstName && person.lastName) {
                  const hunter = this.providers.get('hunter')!;
                  const canSpendHunter =
                    !config.freeFirstMode &&
                    (await this.budgetService.canSpend('hunter', 1, totalCreditsSpent, config.maxBudget));

                  if (canSpendHunter) {
                    const hunterEmailResult = await hunter.findEmail(domain, person.firstName, person.lastName);
                    if (hunterEmailResult.found && hunterEmailResult.email) {
                      directEmail = hunterEmailResult.email;
                      emailStatus = hunterEmailResult.status;
                      confidence = hunterEmailResult.score || 85;
                      totalCreditsSpent += hunterEmailResult.creditsConsumed || 1;
                      await this.budgetService.recordUsage('hunter', hunterEmailResult.creditsConsumed || 1);
                      if (!providersTried.includes('hunter')) providersTried.push('hunter');
                    }
                  }
                }

                if (directEmail) {
                  candidates.push({
                    id: person.providerPersonId,
                    firstName: person.firstName,
                    lastName: person.lastName,
                    fullName: person.fullName,
                    jobTitle: person.title,
                    companyName: item.companyName,
                    companyDomain: domain,
                    matchedRole: match.matchedRole || targetRoles[0] || 'Target Role',
                    email: directEmail,
                    emailStatus,
                    confidenceScore: confidence,
                    sourceProvider: providerKey,
                    linkedinUrl: person.linkedinUrl,
                  });
                }
              }
            }
          }

          // If no candidates found yet, try Hunter Domain Search
          if (candidates.length === 0 && (providerKey === 'hunter' || providerKey === 'mock')) {
            const domainContacts = await provider.searchDomainContacts(domain, targetRoles);

            for (const c of domainContacts) {
              const match = NormalizerService.matchTargetRole(c.position, targetRoles);
              if (match.isMatch || targetRoles.length === 0) {
                candidates.push({
                  id: `hunter-${c.email}`,
                  firstName: c.firstName,
                  lastName: c.lastName,
                  fullName: c.fullName || `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.email.split('@')[0],
                  jobTitle: c.position,
                  companyName: item.companyName,
                  companyDomain: domain,
                  matchedRole: match.matchedRole || targetRoles[0] || 'Target Role',
                  email: c.email,
                  emailStatus: c.status,
                  confidenceScore: c.confidence || 85,
                  sourceProvider: providerKey,
                  sourceUrl: c.sources?.[0]?.uri,
                });
              }
            }
          }

          // If results obtained, stop waterfall for this company
          if (candidates.length > 0) {
            break;
          }
        }

        // Stage E: Verification & Persistence
        await this.prisma.discoveryRunItem.update({
          where: { id: item.id },
          data: { status: 'verifying' },
        });

        let itemContactsSaved = 0;
        for (const candidate of candidates) {
          if (!candidate.email) continue;
          const normalizedEmail = NormalizerService.normalizeEmail(candidate.email);

          // Run verification check
          let status = candidate.emailStatus;
          if (config.verifyEmails && (status === 'unverified' || status === 'unknown')) {
            const verifyRes = await this.verificationService.verifyEmail(normalizedEmail, false);
            status = verifyRes.status;
          }

          // Deduplicate and Upsert Contact
          const contact = await this.prisma.contact.upsert({
            where: { email: normalizedEmail },
            update: {
              firstName: candidate.firstName,
              lastName: candidate.lastName,
              fullName: candidate.fullName,
              jobTitle: candidate.jobTitle,
              companyId: item.companyId,
              companyName: item.companyName,
              companyDomain: domain,
              matchedRole: candidate.matchedRole,
              primarySource: candidate.sourceProvider,
              emailStatus: status,
              confidenceScore: candidate.confidenceScore,
            },
            create: {
              email: normalizedEmail,
              firstName: candidate.firstName,
              lastName: candidate.lastName,
              fullName: candidate.fullName,
              jobTitle: candidate.jobTitle,
              companyId: item.companyId,
              companyName: item.companyName,
              companyDomain: domain,
              matchedRole: candidate.matchedRole,
              primarySource: candidate.sourceProvider,
              emailStatus: status,
              confidenceScore: candidate.confidenceScore,
            },
          });

          // Save Contact Source Provenance
          await this.prisma.contactSource.create({
            data: {
              contactId: contact.id,
              provider: candidate.sourceProvider,
              providerPersonId: candidate.id,
              rawTitle: candidate.jobTitle,
              rawEmail: candidate.email,
              sourceUrl: candidate.sourceUrl || candidate.linkedinUrl,
              confidence: candidate.confidenceScore,
            },
          });

          // Save Verification details
          await this.prisma.emailVerification.create({
            data: {
              contactId: contact.id,
              provider: candidate.sourceProvider,
              status: status,
              score: candidate.confidenceScore,
            },
          });

          itemContactsSaved++;
        }

        totalDiscoveredContacts += itemContactsSaved;

        // Mark item completed
        await this.prisma.discoveryRunItem.update({
          where: { id: item.id },
          data: {
            status: 'completed',
            contactsFound: itemContactsSaved,
            providersTriedJson: JSON.stringify(providersTried),
          },
        });
      } catch (err: any) {
        logger.error(`Company discovery failed for ${item.companyName}`, err);
        await this.prisma.discoveryRunItem.update({
          where: { id: item.id },
          data: {
            status: 'failed',
            errorMessage: err.message,
            providersTriedJson: JSON.stringify(providersTried),
          },
        });
      }

      // Update run progress
      await this.prisma.discoveryRun.update({
        where: { id: runId },
        data: {
          processedCompanies: { increment: 1 },
          contactsFound: totalDiscoveredContacts,
          creditsConsumed: totalCreditsSpent,
        },
      });
    }

    // Mark run complete
    await this.prisma.discoveryRun.update({
      where: { id: runId },
      data: {
        status: 'completed',
        completedAt: new Date(),
        contactsFound: totalDiscoveredContacts,
        creditsConsumed: totalCreditsSpent,
      },
    });
  }
}
