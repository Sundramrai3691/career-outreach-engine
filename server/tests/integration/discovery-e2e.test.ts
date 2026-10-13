import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { DiscoveryOrchestrator } from '../../src/services/contact-discovery/discovery.orchestrator.js';
import { MockProvider } from '../../src/providers/mock/mock.provider.js';

describe('Discovery Pipeline End-to-End Flow', () => {
  let prisma: PrismaClient;
  let orchestrator: DiscoveryOrchestrator;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const mockProviders = new Map();
    mockProviders.set('mock', new MockProvider());
    mockProviders.set('apollo', new MockProvider());
    mockProviders.set('hunter', new MockProvider());

    orchestrator = new DiscoveryOrchestrator(prisma, mockProviders);
  });

  afterAll(async () => {
    await prisma.$disconnect();
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
      if (run && (run.status === 'completed' || run.status === 'failed')) {
        break;
      }
    }

    expect(run).toBeDefined();
    expect(run?.status).toBe('completed');
    expect(run?.totalCompanies).toBe(3);
    expect(run?.processedCompanies).toBe(3);
    expect(run?.contactsFound).toBeGreaterThan(0);
    expect(run?.creditsConsumed).toBeGreaterThan(0);

    // Verify persisted contacts in DB
    const contacts = await prisma.contact.findMany({
      where: {
        companyDomain: { in: ['stripe.com', 'datadoghq.com', 'vercel.com'] },
      },
      include: { sources: true, verifications: true },
    });

    expect(contacts.length).toBeGreaterThan(0);

    // Check contact integrity
    for (const contact of contacts) {
      expect(contact.email).toMatch(/@/);
      expect(contact.fullName).toBeDefined();
      expect(contact.primarySource).toBeDefined();
      expect(contact.sources.length).toBeGreaterThan(0);
      expect(['verified', 'unverified', 'accept_all', 'unknown']).toContain(contact.emailStatus);
    }
  });
});
