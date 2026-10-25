import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { BulkCompanyDiscoveryInputSchema } from '../models/validation.js';
import { DiscoveryOrchestrator } from '../services/contact-discovery/discovery.orchestrator.js';
import { BudgetService } from '../services/provider-budget/budget.service.js';
import { NormalizerService } from '../services/normalizer.service.js';

const CURATED_COMPANIES = [
  { name: 'Stripe', domain: 'stripe.com' },
  { name: 'Google', domain: 'google.com' },
  { name: 'Meta', domain: 'meta.com' },
  { name: 'Apple', domain: 'apple.com' },
  { name: 'Amazon', domain: 'amazon.com' },
  { name: 'Microsoft', domain: 'microsoft.com' },
  { name: 'Netflix', domain: 'netflix.com' },
  { name: 'Uber', domain: 'uber.com' },
  { name: 'Airbnb', domain: 'airbnb.com' },
  { name: 'Coinbase', domain: 'coinbase.com' },
  { name: 'OpenAI', domain: 'openai.com' },
  { name: 'Databricks', domain: 'databricks.com' },
  { name: 'Snowflake', domain: 'snowflake.com' },
  { name: 'Figma', domain: 'figma.com' },
  { name: 'Shopify', domain: 'shopify.com' },
  { name: 'Spotify', domain: 'spotify.com' },
  { name: 'ByteDance', domain: 'bytedance.com' },
  { name: 'DoorDash', domain: 'doordash.com' },
  { name: 'Datadog', domain: 'datadoghq.com' },
  { name: 'Vercel', domain: 'vercel.com' },
];

const CURATED_ROLES = [
  'Technical Recruiter',
  'Senior Technical Recruiter',
  'Lead Technical Recruiter',
  'Head of Talent Acquisition',
  'Recruiting Manager',
  'Talent Acquisition Partner',
  'Engineering Manager',
  'Senior Engineering Manager',
  'Director of Engineering',
  'VP of Engineering',
  'Staff Software Engineer',
  'Principal Software Engineer',
  'Head of Engineering',
  'Product Manager',
  'Head of People',
];

const CURATED_LOCATIONS = [
  'San Francisco, CA',
  'New York, NY',
  'Seattle, WA',
  'Austin, TX',
  'Los Angeles, CA',
  'Boston, MA',
  'Chicago, IL',
  'London, United Kingdom',
  'Toronto, Canada',
  'Berlin, Germany',
  'Remote (US)',
  'Remote (Global)',
];

export function createDiscoveryRouter(
  prisma: PrismaClient,
  orchestrator: DiscoveryOrchestrator
): Router {
  const router = Router();
  const budgetService = new BudgetService(prisma);

  /**
   * Fast autocomplete suggestions for companies, target roles, and locations
   */
  router.get('/suggestions', async (req, res, next) => {
    try {
      const type = (req.query.type as string) || 'companies';
      const q = ((req.query.q as string) || '').trim().toLowerCase();

      if (type === 'companies') {
        const dbCompanies = await prisma.company.findMany({
          where: q ? { name: { contains: q } } : undefined,
          select: { name: true, domain: true },
          take: 10,
        });

        const map = new Map<string, { value: string; label: string; subtext?: string }>();

        for (const c of dbCompanies) {
          if (!map.has(c.name.toLowerCase())) {
            map.set(c.name.toLowerCase(), {
              value: c.name,
              label: c.name,
              subtext: c.domain || undefined,
            });
          }
        }

        for (const c of CURATED_COMPANIES) {
          if (!q || c.name.toLowerCase().includes(q) || c.domain.toLowerCase().includes(q)) {
            if (!map.has(c.name.toLowerCase())) {
              map.set(c.name.toLowerCase(), {
                value: c.name,
                label: c.name,
                subtext: c.domain,
              });
            }
          }
        }

        return res.json({ suggestions: Array.from(map.values()).slice(0, 12) });
      }

      if (type === 'roles') {
        const dbRoles = await prisma.targetRole.findMany({
          where: q ? { title: { contains: q } } : undefined,
          select: { title: true, category: true },
          take: 10,
        });

        const map = new Map<string, { value: string; label: string; subtext?: string }>();

        for (const r of dbRoles) {
          if (!map.has(r.title.toLowerCase())) {
            map.set(r.title.toLowerCase(), {
              value: r.title,
              label: r.title,
              subtext: r.category || undefined,
            });
          }
        }

        for (const r of CURATED_ROLES) {
          if (!q || r.toLowerCase().includes(q)) {
            if (!map.has(r.toLowerCase())) {
              map.set(r.toLowerCase(), {
                value: r,
                label: r,
              });
            }
          }
        }

        return res.json({ suggestions: Array.from(map.values()).slice(0, 12) });
      }

      if (type === 'locations') {
        const map = new Map<string, { value: string; label: string; subtext?: string }>();

        for (const loc of CURATED_LOCATIONS) {
          if (!q || loc.toLowerCase().includes(q)) {
            map.set(loc.toLowerCase(), {
              value: loc,
              label: loc,
            });
          }
        }

        return res.json({ suggestions: Array.from(map.values()).slice(0, 12) });
      }

      res.json({ suggestions: [] });
    } catch (err) {
      next(err);
    }
  });

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
      const companies = await Promise.all(parsed.companies.map(async (target) => {
        if (target.domain) return target;
        const normalizedName = NormalizerService.normalizeCompanyName(target.name).toLowerCase();
        const curated = CURATED_COMPANIES.find(
          (company) => NormalizerService.normalizeCompanyName(company.name).toLowerCase() === normalizedName
        );
        if (curated) return { ...target, domain: curated.domain };
        const existing = await prisma.company.findFirst({
          where: { name: target.name },
          select: { domain: true },
        });
        return { ...target, domain: existing?.domain || undefined };
      }));
      const runId = await orchestrator.startDiscovery(companies, parsed.config);
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
            include: {
              jobDiscoveries: {
                include: { jobOpening: true },
                orderBy: { createdAt: 'asc' },
              },
            },
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
