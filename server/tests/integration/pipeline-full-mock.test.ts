import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ContactImportService } from '../../src/services/contact-import/import.service.js';
import { GoogleWorkspaceService } from '../../src/services/google/google.service.js';
import { NativeGmailService } from '../../src/services/gmail/gmail.service.js';
import { DiscoveryOrchestrator } from '../../src/services/contact-discovery/discovery.orchestrator.js';
import { IContactProvider } from '../../src/providers/base.provider.js';
import { ProviderName } from '../../src/models/types.js';
import { JobDiscoveryService } from '../../src/services/job-discovery/job-discovery.service.js';
import { createIsolatedPrisma } from '../helpers/isolated-prisma.js';

// Hoist Google API mocks
const mocks = vi.hoisted(() => ({
  mockSheets: {
    spreadsheets: {
      create: vi.fn().mockResolvedValue({
        data: {
          spreadsheetId: 'test-sheet-e2e-999',
          spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/test-sheet-e2e-999/edit',
        },
      }),
      values: {
        update: vi.fn().mockResolvedValue({ data: { updatedRows: 3 } }),
      },
      batchUpdate: vi.fn().mockResolvedValue({ data: {} }),
    },
  },
  mockDocs: {
    documents: {
      create: vi.fn().mockResolvedValue({
        data: { documentId: 'test-doc-template-999' },
      }),
      batchUpdate: vi.fn().mockResolvedValue({ data: {} }),
    },
  },
  mockGmail: {
    users: {
      drafts: {
        create: vi.fn().mockImplementation((args) => {
          return Promise.resolve({
            data: { id: `draft-${Math.random().toString(36).substring(7)}`, message: args.requestBody?.message },
          });
        }),
      },
      messages: {
        send: vi.fn().mockImplementation(() => {
          throw new Error('FATAL: Real email send invoked in test suite!');
        }),
      },
    },
  },
}));

vi.mock('googleapis', () => ({
  google: {
    sheets: () => mocks.mockSheets,
    docs: () => mocks.mockDocs,
    gmail: () => mocks.mockGmail,
  },
}));

describe('Complete Outreach Pipeline with Fallbacks & Safe Gmail Drafts', () => {
  const noNetworkJobDiscovery = {
    discoverForRunItem: vi.fn().mockResolvedValue({
      status: 'unsupported_source',
      jobsFound: 0,
      message: 'Job discovery is not part of this contact-pipeline test.',
      providersTried: [],
    }),
  } as unknown as JobDiscoveryService;
  const terminalRunStatuses = new Set([
    'completed',
    'completed_with_results',
    'completed_no_results',
    'completed_jobs_only',
    'partially_completed',
    'waiting_for_credentials',
    'blocked_by_provider',
    'failed',
    'cancelled',
  ]);

  async function waitForDiscoveryRun(runId: string): Promise<any> {
    for (let attempt = 0; attempt < 120; attempt++) {
      const run = await prisma.discoveryRun.findUnique({
        where: { id: runId },
        include: { items: true },
      });
      if (run && terminalRunStatuses.has(run.status)) return run;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Discovery run ${runId} did not reach a terminal state.`);
  }

  let prisma: PrismaClient;
  let cleanupDatabase: () => Promise<void>;
  let importService: ContactImportService;
  let workspaceService: GoogleWorkspaceService;
  let gmailService: NativeGmailService;

  const mockGoogleAuth: any = {
    getAuthenticatedClient: vi.fn().mockResolvedValue({}),
    getConnectionStatus: vi.fn().mockResolvedValue({
      isConfigured: true,
      isConnected: true,
      account: { email: 'recruiter.me@example.com', name: 'Test Outreach Account' },
    }),
  };

  beforeAll(async () => {
    const isolated = await createIsolatedPrisma();
    prisma = isolated.prisma;
    cleanupDatabase = isolated.cleanup;
    importService = new ContactImportService(prisma);
    workspaceService = new GoogleWorkspaceService(prisma, mockGoogleAuth);
    gmailService = new NativeGmailService(prisma, mockGoogleAuth);
  });

  afterAll(async () => {
    if (cleanupDatabase) await cleanupDatabase();
  });

  it('Step 1 & 2: Imports contacts from CSV with validation, deduplication, and source provenance', async () => {
    const uniqueSuffix = Date.now();
    const csvContent = `company,role,name,email,source,verification_status
Stripe,Technical Recruiter,Jordan Cole,jordan.cole.${uniqueSuffix}@stripe.com,manual_import,verified
Datadog,Senior Engineering Manager,Morgan Lee,morgan.lee.${uniqueSuffix}@datadoghq.com,manual_import,verified
Stripe,Lead Talent Partner,Casey Bell,casey.bell.${uniqueSuffix}@stripe.com,manual_import,unverified
InvalidRow,Developer,No Email Here,,manual_import,unknown`;

    // First import
    const result1 = await importService.importCsv(csvContent, 'lead_batch_1.csv');

    expect(result1.summary.totalRows).toBe(4);
    expect(result1.summary.imported).toBe(3);
    expect(result1.summary.errors).toBe(1); // row 4 without email
    expect(result1.contacts.length).toBe(3);

    // Verify company association
    const stripeCompany = await prisma.company.findFirst({
      where: { name: 'Stripe' },
    });
    expect(stripeCompany).toBeDefined();

    // Re-importing same CSV must deduplicate and not inflate contact count
    const result2 = await importService.importCsv(csvContent, 'lead_batch_1_retry.csv');
    expect(result2.summary.imported).toBe(0); // 0 new contacts
    expect(result2.summary.updated).toBe(3); // 3 contacts updated

    // Verify source provenance was appended
    const jordan = await prisma.contact.findUnique({
      where: { email: `jordan.cole.${uniqueSuffix}@stripe.com` },
      include: { sources: true, verifications: true },
    });
    expect(jordan).toBeDefined();
    expect(jordan?.sources.length).toBeGreaterThanOrEqual(2);
  }, 15000);

  it('Step 3 & 4: Selects imported contacts and prepares Google Mail Merge (Sheets + Docs template)', async () => {
    const uniqueSuffix = Date.now();
    const csvData = `company,role,name,email,source,verification_status
Acme Corp,Talent Lead,Taylor Swift,taylor.lead.${uniqueSuffix}@acmecorp.com,csv_import,verified
Acme Corp,Engineering Director,Sam Altman,sam.dir.${uniqueSuffix}@acmecorp.com,csv_import,verified`;

    const imported = await importService.importCsv(csvData, 'mail_merge_targets.csv');
    const contactIds = imported.contacts.map((c) => c.id);

    // Prepare Google Mail Merge
    const mailMerge = await workspaceService.prepareGoogleMailMerge({
      campaignName: `E2E Merge Campaign ${uniqueSuffix}`,
      contactIds,
      draftSubject: 'Exploring Opportunities at {{Company}}',
      draftBody: 'Hi {{FirstName}},\n\nNoticed your work as {{Role}} at {{Company}}. Would love to connect!',
    });

    expect(mailMerge.spreadsheetId).toBe('test-sheet-e2e-999');
    expect(mailMerge.documentId).toBe('test-doc-template-999');
    expect(mailMerge.campaignId).toBeDefined();

    // Verify mock Google Sheets API was called with column headers and contact rows
    expect(mocks.mockSheets.spreadsheets.create).toHaveBeenCalled();
    expect(mocks.mockSheets.spreadsheets.values.update).toHaveBeenCalledWith(
      expect.objectContaining({
        spreadsheetId: 'test-sheet-e2e-999',
        range: 'Sheet1!A1',
      })
    );

    // Verify mock Google Docs API was called with template tags
    expect(mocks.mockDocs.documents.create).toHaveBeenCalled();
    expect(mocks.mockDocs.documents.batchUpdate).toHaveBeenCalled();
  });

  it('Step 5: Prepares Gmail drafts with isDraftOnly: true, ensuring ZERO real emails are dispatched', async () => {
    const uniqueSuffix = Date.now();
    const contact = await prisma.contact.create({
      data: {
        email: `draft.target.${uniqueSuffix}@example.org`,
        firstName: 'Devon',
        lastName: 'Miles',
        fullName: 'Devon Miles',
        companyName: 'Foundation Systems',
        matchedRole: 'Engineering Lead',
        primarySource: 'csv_import',
        emailStatus: 'verified',
      },
    });

    const mailMerge = await workspaceService.prepareGoogleMailMerge({
      campaignName: `Draft Only Test Campaign ${uniqueSuffix}`,
      contactIds: [contact.id],
      draftSubject: 'Quick inquiry regarding {{Role}} at {{Company}}',
      draftBody: 'Hi {{FirstName}},\n\nReaching out regarding your role at {{Company}}.',
    });

    const recipients = await prisma.campaignRecipient.findMany({
      where: { campaignId: mailMerge.campaignId },
    });
    expect(recipients.length).toBe(1);

    // Dispatch in draft mode
    const dispatchResult = await gmailService.dispatchMessages({
      campaignId: mailMerge.campaignId,
      recipientIds: [recipients[0].id],
      isDraftOnly: true,
    });

    expect(dispatchResult.draftsCount).toBe(1);
    expect(dispatchResult.failedCount).toBe(0);

    // Verify Gmail drafts.create was invoked, but messages.send was NEVER called
    expect(mocks.mockGmail.users.drafts.create).toHaveBeenCalled();
    expect(mocks.mockGmail.users.messages.send).not.toHaveBeenCalled();

    // Verify recipient status is updated to 'draft_created'
    const recipient = await prisma.campaignRecipient.findFirst({
      where: { campaignId: mailMerge.campaignId, contactId: contact.id },
    });
    expect(recipient?.status).toBe('draft_created');
  });

  it('Step 6: Discovery partial results retention when provider fails or is blocked', async () => {
    const uniqueDomain = `domain-${Date.now()}.com`;

    // Create a mock provider that returns a contact, followed by an error provider
    const mockSuccessProvider: IContactProvider = {
      name: 'mock',
      searchPeople: vi.fn().mockResolvedValue([
        {
          providerPersonId: 'pers-1',
          firstName: 'Robin',
          lastName: 'Banks',
          fullName: 'Robin Banks',
          title: 'Technical Recruiter',
          companyName: 'SecureBank',
        },
      ]),
      enrichPerson: vi.fn().mockResolvedValue({
        success: true,
        email: `robin@${uniqueDomain}`,
        emailStatus: 'verified',
        creditsConsumed: 1,
      }),
      searchDomainContacts: vi.fn().mockResolvedValue([]),
      findEmail: vi.fn().mockResolvedValue({ found: false }),
      verifyEmail: vi.fn().mockResolvedValue({ status: 'verified', deliverable: true, score: 90 }),
      healthCheck: vi.fn().mockResolvedValue({ healthy: true, provider: 'mock' }),
      getUsage: vi.fn().mockResolvedValue({ planName: 'Test', isUnlimited: true }),
      getLastError: vi.fn().mockReturnValue(null),
      clearLastError: vi.fn(),
    };

    const customProviders = new Map<ProviderName, IContactProvider>();
    customProviders.set('mock', mockSuccessProvider);

    const orchestrator = new DiscoveryOrchestrator(prisma, customProviders, noNetworkJobDiscovery);

    const runId = await orchestrator.startDiscovery(
      [
        {
          name: 'SecureBank',
          domain: uniqueDomain,
          targetRoles: ['Technical Recruiter'],
        },
      ],
      {
        providerPriority: ['mock'],
        allowEnrichment: true,
        freeFirstMode: false,
        verifyEmails: false,
      }
    );

    const finishedRun = await waitForDiscoveryRun(runId);

    expect(finishedRun).toBeDefined();
    expect(finishedRun?.contactsFound).toBe(1);
    expect(finishedRun?.status).toBe('completed_with_results');

    // Confirm candidate was saved in database
    const savedContact = await prisma.contact.findUnique({
      where: { email: `robin@${uniqueDomain}` },
    });
    expect(savedContact).toBeDefined();
    expect(savedContact?.fullName).toBe('Robin Banks');
  }, 15000);

  it('Step 7: Tomba domain discovery integrates with orchestrator and saves matched contacts', async () => {
    const uniqueDomain = `stripe-${Date.now()}.com`;

    const mockTombaProvider: IContactProvider = {
      name: 'tomba',
      searchPeople: vi.fn().mockResolvedValue([]),
      enrichPerson: vi.fn().mockResolvedValue({ success: false }),
      searchDomainContacts: vi.fn().mockResolvedValue([
        {
          providerContactId: 'tb-123',
          email: `recruiter@${uniqueDomain}`,
          firstName: 'Taylor',
          lastName: 'Swift',
          fullName: 'Taylor Swift',
          position: 'Senior Technical Recruiter',
          title: 'Senior Technical Recruiter',
          companyName: 'Stripe',
          confidence: 90,
          status: 'verified',
          metadata: {
            department: 'hr',
            seniority: 'senior',
          },
        },
      ]),
      findEmail: vi.fn().mockResolvedValue({ found: false }),
      verifyEmail: vi.fn().mockResolvedValue({ status: 'valid', score: 95 }),
      healthCheck: vi.fn().mockResolvedValue({
        healthy: true,
        provider: 'tomba',
        status: 'healthy',
        authConfigured: true,
        canSearch: true,
      }),
      getUsage: vi.fn().mockResolvedValue({ planName: 'Free', availableSearches: 25 }),
      getLastError: vi.fn().mockReturnValue(null),
      clearLastError: vi.fn(),
    };

    const customProviders = new Map<ProviderName, IContactProvider>();
    customProviders.set('tomba', mockTombaProvider);

    const orchestrator = new DiscoveryOrchestrator(prisma, customProviders, noNetworkJobDiscovery);

    const runId = await orchestrator.startDiscovery(
      [
        {
          name: 'Stripe',
          domain: uniqueDomain,
          targetRoles: ['Technical Recruiter'],
          location: 'San Francisco, CA',
        },
      ],
      {
        providerPriority: ['tomba'],
        allowEnrichment: false,
        freeFirstMode: true,
        verifyEmails: false,
      }
    );

    const finishedRun = await waitForDiscoveryRun(runId);

    expect(finishedRun).toBeDefined();
    expect(finishedRun?.contactsFound).toBe(1);
    expect(finishedRun?.status).toBe('completed_with_results');

    // Confirm candidate was saved in database
    const savedContact = await prisma.contact.findUnique({
      where: { email: `recruiter@${uniqueDomain}` },
    });
    expect(savedContact).toBeDefined();
    expect(savedContact?.fullName).toBe('Taylor Swift');
    expect(savedContact?.primarySource).toBe('tomba');
    expect(mockTombaProvider.searchDomainContacts).toHaveBeenCalledWith(
      uniqueDomain,
      ['Technical Recruiter'],
      expect.objectContaining({
        department: 'hr',
        country: 'US',
      })
    );
  }, 15000);
});
