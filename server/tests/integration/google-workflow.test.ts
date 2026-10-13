import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { GoogleWorkspaceService } from '../../src/services/google/google.service.js';
import { NativeGmailService } from '../../src/services/gmail/gmail.service.js';

// Hoist mock clients so Vitest hoisting works cleanly
const mocks = vi.hoisted(() => ({
  mockSheets: {
    spreadsheets: {
      create: vi.fn().mockResolvedValue({
        data: {
          spreadsheetId: 'mock-sheet-12345',
          spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/mock-sheet-12345/edit',
        },
      }),
      values: {
        update: vi.fn().mockResolvedValue({ data: {} }),
      },
      batchUpdate: vi.fn().mockResolvedValue({ data: {} }),
    },
  },
  mockDocs: {
    documents: {
      create: vi.fn().mockResolvedValue({
        data: { documentId: 'mock-doc-67890' },
      }),
      batchUpdate: vi.fn().mockResolvedValue({ data: {} }),
    },
  },
  mockGmail: {
    users: {
      drafts: {
        create: vi.fn().mockResolvedValue({ data: { id: 'mock-draft-111' } }),
      },
      messages: {
        send: vi.fn().mockResolvedValue({ data: { id: 'mock-msg-222' } }),
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

describe('Google Workspace & Mail Merge Workflow Integration', () => {
  let prisma: PrismaClient;
  let workspaceService: GoogleWorkspaceService;
  let gmailService: NativeGmailService;

  const mockGoogleAuth: any = {
    getAuthenticatedClient: vi.fn().mockResolvedValue({}),
    getConnectionStatus: vi.fn().mockResolvedValue({
      isConfigured: true,
      isConnected: true,
      account: { email: 'user@example.com', name: 'Test User' },
    }),
  };

  beforeAll(async () => {
    prisma = new PrismaClient();
    workspaceService = new GoogleWorkspaceService(prisma, mockGoogleAuth);
    gmailService = new NativeGmailService(prisma, mockGoogleAuth);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('prepares Google Mail Merge spreadsheet, docs template, and instructions', async () => {
    // 1. Create test contact in database
    const contact = await prisma.contact.create({
      data: {
        email: `test.candidate.${Date.now()}@example.com`,
        firstName: 'Alex',
        lastName: 'Rivera',
        fullName: 'Alex Rivera',
        companyName: 'Acme Corp',
        matchedRole: 'Software Engineer',
        primarySource: 'mock',
        emailStatus: 'verified',
      },
    });

    // 2. Prepare Google Mail Merge
    const result = await workspaceService.prepareGoogleMailMerge({
      campaignName: 'Test Fall Outreach',
      contactIds: [contact.id],
      draftSubject: 'Hi {{FirstName}} - {{Role}} opportunities',
      draftBody: 'Hello {{FirstName}},\n\nExcited to connect about {{Company}}!',
    });

    expect(result.spreadsheetId).toBe('mock-sheet-12345');
    expect(result.spreadsheetUrl).toContain('docs.google.com/spreadsheets');
    expect(result.documentId).toBe('mock-doc-67890');
    expect(result.documentUrl).toContain('docs.google.com/document');
    expect(result.recipientCount).toBe(1);
    expect(result.mailmeteorInstructions.step1).toBeDefined();

    // 3. Verify recipient records and idempotency keys
    const recipients = await prisma.campaignRecipient.findMany({
      where: { campaignId: result.campaignId },
    });
    expect(recipients.length).toBe(1);
    expect(recipients[0].idempotencyKey).toBeDefined();

    // 4. Test Native Gmail draft creation
    const dispatch = await gmailService.dispatchMessages({
      campaignId: result.campaignId,
      recipientIds: [recipients[0].id],
      isDraftOnly: true,
    });

    expect(dispatch.draftsCount).toBe(1);
    expect(dispatch.failedCount).toBe(0);

    const updatedRecipient = await prisma.campaignRecipient.findUnique({
      where: { id: recipients[0].id },
    });
    expect(updatedRecipient?.status).toBe('draft_created');
    expect(updatedRecipient?.gmailDraftId).toBe('mock-draft-111');
  });
});
