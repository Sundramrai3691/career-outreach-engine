import { describe, it, expect, vi } from 'vitest';
import { BudgetService } from '../../src/services/provider-budget/budget.service.js';

describe('BudgetService Unit Tests', () => {
  const mockPrisma: any = {
    providerSetting: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  };

  const budgetService = new BudgetService(mockPrisma);

  it('estimates 0 credit cost when freeFirstMode is true and enrichment is disabled', async () => {
    const estimate = await budgetService.estimateRunCost(5, 2, false, true, false);
    expect(estimate.estimatedCostMin).toBe(0);
    expect(estimate.estimatedCostMax).toBe(0);
    expect(estimate.canProceed).toBe(true);
    expect(estimate.warnings.length).toBe(0);
  });

  it('estimates credit ranges when enrichment and verification are enabled', async () => {
    const estimate = await budgetService.estimateRunCost(4, 2, true, false, true, 50);
    expect(estimate.estimatedCostMin).toBeGreaterThan(0);
    expect(estimate.estimatedCostMax).toBeGreaterThan(estimate.estimatedCostMin);
    expect(estimate.canProceed).toBe(true);
  });

  it('warns and blocks if estimated cost exceeds configured max budget', async () => {
    const estimate = await budgetService.estimateRunCost(20, 3, true, false, true, 5);
    expect(estimate.canProceed).toBe(false);
    expect(estimate.warnings.length).toBeGreaterThan(0);
  });

  it('enforces provider spending cap', async () => {
    mockPrisma.providerSetting.findUnique.mockResolvedValue({
      providerKey: 'hunter',
      isEnabled: true,
      spendingCap: 10,
      creditsUsed: 10,
    });

    const canSpend = await budgetService.canSpend('hunter', 1, 0, 50);
    expect(canSpend).toBe(false);
  });
});
