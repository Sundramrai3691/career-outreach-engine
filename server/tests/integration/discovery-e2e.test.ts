import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { DiscoveryOrchestrator } from '../../src/services/contact-discovery/discovery.orchestrator.js';
import { MockProvider } from '../../src/providers/mock/mock.provider.js';
import { JobDiscoveryService } from '../../src/services/job-discovery/job-discovery.service.js';
import { createIsolatedPrisma } from '../helpers/isolated-prisma.js';

describe('Discovery Pipeline End-to-End Flow', () => {
  let prisma: PrismaClient;
  let cleanupDatabase: () => Promise<void>;
  let orchestrator: DiscoveryOrchestrator;

  beforeAll(async () => {
    const isolated = await createIsolatedPrisma();
    prisma = isolated.prisma;
    cleanupDatabase = isolated.cleanup;
    const mockProviders = new Map();
    mockProviders.set('mock', new MockProvider());
    mockProviders.set('apollo', new MockProvider());
    mockProviders.set('hunter', new MockProvider());

    const jobDiscovery = new JobDiscoveryService(prisma, [], undefined, () => ({
      name: 'official_careers',
      discover: async (company) => [{
        externalId: `fixture-${company.id}`,
        title: company.name === 'Datadog'
          ? 'Head of Talent Acquisition'
          : company.name === 'Vercel'
          ? 'Recruiter'
          : 'Technical Recruiter',
        location: 'San Francisco, CA',
        description: 'Mock public job source fixture.',
        jobUrl: `https://careers.${company.domain}/jobs/${encodeURIComponent(company.id)}`,
        sourceUrl: `https://careers.${company.domain}/careers`,
      }],
    }));
    orchestrator = new DiscoveryOrchestrator(prisma, mockProviders, jobDiscovery);
  });

  afterAll(async () => {
    if (cleanupDatabase) await cleanupDatabase();
  });

  it('runs complete multi-company discovery, waterfall fallback, deduplication, and database persistence', async () => {
    const inputTargets = [
      {
        name: 'Stripe, Inc.',
        domain: 'stripe.com',
        targetRoles: ['Technical Recruiter', 'Engineering Manager'],
      },
      {
        name: 'Datadog',
        domain: 'datadoghq.com',
        targetRoles: ['Head of Talent Acquisition'],
      },
      {
        name: 'Vercel',
        domain: 'vercel.com',
        targetRoles: ['Recruiter'],
      },
    ];

    const runId = await orchestrator.startDiscovery(inputTargets, {
      maxBudget: 25,
      allowEnrichment: true,
      freeFirstMode: false,
      verifyEmails: true,
      providerPriority: ['mock'],
    });

    expect(runId).toBeDefined();

    // Poll until run completes (usually < 2 seconds with mock provider)
    let run;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 200));
      run = await prisma.discoveryRun.findUnique({
        where: { id: runId },
        include: { items: true },
      });
      if (run && (run.status === 'completed' || run.status === 'completed_with_results' || run.status === 'failed')) {
        break;
      }
    }

    expect(run).toBeDefined();
    expect(['completed', 'completed_with_results']).toContain(run?.status);
    expect(run?.totalCompanies).toBe(3);
    expect(run?.processedCompanies).toBe(3);
    expect(run?.contactsFound).toBeGreaterThan(0);
    expect(run?.creditsConsumed).toBeGreaterThan(0);
    expect(run?.items.every((item) => item.jobsFound === 1)).toBe(true);

    // Verify persisted contacts in DB
    const contacts = await prisma.contact.findMany({
      where: {
        companyDomain: { in: ['stripe.com', 'datadoghq.com', 'vercel.com'] },
      },
      include: { sources: true, verifications: true },
    });

    expect(contacts.length).toBeGreaterThan(0);

    const jobOpenings = await prisma.jobOpening.findMany({
      where: { companyId: { in: (run?.items || []).map((item) => item.companyId!).filter(Boolean) } },
      include: { discoveries: true },
    });
    expect(jobOpenings.length).toBe(3);
    expect(jobOpenings.every((job) => job.discoveries.length > 0)).toBe(true);
    expect(jobOpenings.every((job) => job.status === 'active' && job.lastChangeType === 'new')).toBe(true);
    const watchlist = await prisma.company.findMany({
      where: { id: { in: (run?.items || []).map((item) => item.companyId!).filter(Boolean) } },
    });
    expect(watchlist.every((company) => company.isJobWatchlisted)).toBe(true);
    const trackedSources = await prisma.companyJobSource.findMany({
      where: { companyId: { in: watchlist.map((company) => company.id) } },
    });
    expect(trackedSources).toHaveLength(3);
    expect(trackedSources.every((source) => source.isValidated && source.status === 'success')).toBe(true);

    // Check contact integrity
    for (const contact of contacts) {
      expect(contact.email).toMatch(/@/);
      expect(contact.fullName).toBeDefined();
      expect(contact.primarySource).toBeDefined();
      expect(contact.sources.length).toBeGreaterThan(0);
      expect(['verified', 'unverified', 'accept_all', 'unknown']).toContain(contact.emailStatus);
    }
  }, 15000);
});
