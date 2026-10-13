import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { BulkCompanyDiscoveryInputSchema } from '../models/validation.js';
import { DiscoveryOrchestrator } from '../services/contact-discovery/discovery.orchestrator.js';
import { BudgetService } from '../services/provider-budget/budget.service.js';

export function createDiscoveryRouter(
  prisma: PrismaClient,
  orchestrator: DiscoveryOrchestrator
): Router {
  const router = Router();
  const budgetService = new BudgetService(prisma);

  /**
   * Pre-flight cost estimation
   */
  router.post('/estimate', async (req, res, next) => {
    try {
      const { companiesCount, rolesCount, allowEnrichment, freeFirstMode, verifyEmails, maxBudget } = req.body;
      const estimate = await budgetService.estimateRunCost(
        Number(companiesCount) || 1,
        Number(rolesCount) || 1,
        Boolean(allowEnrichment),
        freeFirstMode !== false,
        verifyEmails !== false,
        maxBudget ? Number(maxBudget) : undefined
      );
      res.json(estimate);
    } catch (err) {
      next(err);
    }
  });

  /**
   * Start contact discovery run
   */
  router.post('/start', async (req, res, next) => {
    try {
      const parsed = BulkCompanyDiscoveryInputSchema.parse(req.body);
      const runId = await orchestrator.startDiscovery(parsed.companies, parsed.config);
      res.status(202).json({
        success: true,
        runId,
        message: 'Contact discovery run initialized successfully.',
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * List recent discovery runs
   */
  router.get('/runs', async (req, res, next) => {
    try {
      const runs = await prisma.discoveryRun.findMany({
        take: 20,
        orderBy: { startedAt: 'desc' },
        include: {
          _count: { select: { items: true } },
        },
      });
      res.json(runs);
    } catch (err) {
      next(err);
    }
  });

  /**
   * Get specific run progress and item states
   */
  router.get('/runs/:id', async (req, res, next) => {
    try {
      const run = await prisma.discoveryRun.findUnique({
        where: { id: req.params.id },
        include: {
          items: {
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      if (!run) {
        return res.status(404).json({ error: 'Discovery run not found' });
      }

      res.json(run);
    } catch (err) {
      next(err);
    }
  });

  /**
   * Cancel run
   */
  router.post('/runs/:id/cancel', async (req, res, next) => {
    try {
      orchestrator.cancelRun(req.params.id);
      await prisma.discoveryRun.update({
        where: { id: req.params.id },
        data: { status: 'cancelled' },
      });
      res.json({ success: true, message: 'Discovery run marked cancelled.' });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
