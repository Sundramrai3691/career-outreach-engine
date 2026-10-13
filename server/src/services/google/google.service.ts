import { google } from 'googleapis';
import { PrismaClient } from '@prisma/client';
import { GoogleAuthService } from './google-auth.service.js';
import { SuppressionService } from '../suppression.service.js';
import { logger } from '../../utils/logger.js';
import crypto from 'node:crypto';

export interface MailMergePreparationResult {
  campaignId: string;
  spreadsheetId: string;
  spreadsheetUrl: string;
  documentId: string;
  documentUrl: string;
  recipientCount: number;
  skippedCount: number;
  warnings: string[];
  mailmeteorInstructions: {
    step1: string;
    step2: string;
    step3: string;
    step4: string;
  };
}

export class GoogleWorkspaceService {
  private suppressionService: SuppressionService;

  constructor(
    private prisma: PrismaClient,
    private authService: GoogleAuthService
  ) {
    this.suppressionService = new SuppressionService(prisma);
  }

  /**
   * Generates formatted Google Sheet and Google Doc mail-merge template
   */
  async prepareGoogleMailMerge(params: {
    campaignName: string;
    contactIds: string[];
    templateId?: string | null;
    draftSubject?: string;
    draftBody?: string;
    reuseExistingCampaignId?: string | null;
  }): Promise<MailMergePreparationResult> {
    const auth = await this.authService.getAuthenticatedClient();
    const sheets = google.sheets({ version: 'v4', auth });
    const docs = google.docs({ version: 'v1', auth });

    const warnings: string[] = [];

    // 1. Fetch Contacts
    const contacts = await this.prisma.contact.findMany({
      where: { id: { in: params.contactIds } },
    });

    if (contacts.length === 0) {
      throw new Error('No contacts found for selected IDs.');
    }

    // 2. Validate and filter out suppressed/invalid emails
    const validRecipients = [];
    let skippedCount = 0;

    for (const c of contacts) {
      const suppression = await this.suppressionService.isSuppressed(c.email);
      if (suppression.suppressed) {
        skippedCount++;
        warnings.push(`Skipped ${c.email}: address is suppressed (${suppression.reason}).`);
        continue;
      }

      if (c.emailStatus === 'invalid') {
        skippedCount++;
        warnings.push(`Skipped ${c.email}: marked as invalid deliverability status.`);
        continue;
      }

      if (c.emailStatus === 'accept_all' || c.emailStatus === 'unknown') {
        warnings.push(`Notice for ${c.email}: address status is '${c.emailStatus}' (proceed with caution).`);
      }

      validRecipients.push(c);
    }

    if (validRecipients.length === 0) {
      throw new Error('All selected contacts are either suppressed or invalid. No recipients to export.');
    }

    // 3. Resolve or Create Campaign
    let campaign = params.reuseExistingCampaignId
      ? await this.prisma.campaign.findUnique({ where: { id: params.reuseExistingCampaignId } })
      : null;

    if (!campaign) {
      campaign = await this.prisma.campaign.create({
        data: {
          name: params.campaignName,
          status: 'prepared',
          templateId: params.templateId || undefined,
          totalRecipients: validRecipients.length,
        },
      });
    }

    // 4. Create or reuse Google Spreadsheet
    let spreadsheetId = campaign.googleSpreadsheetId;
    let spreadsheetUrl = campaign.googleSpreadsheetUrl;

    if (!spreadsheetId) {
      const sheetTitle = `Outreach - ${params.campaignName} - ${new Date().toISOString().split('T')[0]}`;
      const sheetRes = await sheets.spreadsheets.create({
        requestBody: {
          properties: { title: sheetTitle },
        },
      });

      spreadsheetId = sheetRes.data.spreadsheetId!;
      spreadsheetUrl = sheetRes.data.spreadsheetUrl!;

      // Prepare Rows
      const headerRow = [
        'Email',
        'FirstName',
        'LastName',
        'FullName',
        'Company',
        'JobTitle',
        'Role',
        'JobURL',
        'Notes',
        'Status',
      ];

      const dataRows = validRecipients.map((c) => [
        c.email,
        c.firstName || '',
        c.lastName || '',
        c.fullName || '',
        c.companyName || '',
        c.jobTitle || '',
        c.matchedRole || '',
        '', // JobURL
        c.notes || '',
        'Ready',
      ]);

      // Populate Spreadsheet
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'Sheet1!A1',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [headerRow, ...dataRows],
        },
      });

      // Format Sheet: Freeze row 1 and bold headers
      try {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              {
                updateSheetProperties: {
                  properties: {
                    sheetId: 0,
                    gridProperties: { frozenRowCount: 1 },
                  },
                  fields: 'gridProperties.frozenRowCount',
                },
              },
              {
                repeatCell: {
                  range: {
                    sheetId: 0,
                    startRowIndex: 0,
                    endRowIndex: 1,
                  },
                  cell: {
                    userEnteredFormat: {
                      backgroundColor: { red: 0.94, green: 0.96, blue: 0.98 },
                      textFormat: { bold: true },
                    },
                  },
                  fields: 'userEnteredFormat(backgroundColor,textFormat)',
                },
              },
              {
                setBasicFilter: {
                  filter: {
                    range: {
                      sheetId: 0,
                      startRowIndex: 0,
                      endRowIndex: validRecipients.length + 1,
                      startColumnIndex: 0,
                      endColumnIndex: headerRow.length,
                    },
                  },
                },
              },
            ],
          },
        });
      } catch (styleErr) {
        logger.warn('Non-critical spreadsheet styling update failed', styleErr);
      }
    }

    // 5. Create or reuse Google Docs template
    let documentId = campaign.googleDocId;
    let documentUrl = campaign.googleDocUrl;

    if (!documentId) {
      const docTitle = `Email Template - ${params.campaignName}`;
      const docRes = await docs.documents.create({
        requestBody: { title: docTitle },
      });

      documentId = docRes.data.documentId!;
      documentUrl = `https://docs.google.com/document/d/${documentId}/edit`;

      const subject = params.draftSubject || 'Reaching out regarding {{Role}} opportunities at {{Company}}';
      const body =
        params.draftBody ||
        `Hi {{FirstName}},\n\nI hope you're having a great week.\n\nI noticed your work at {{Company}} and wanted to reach out regarding {{Role}} opportunities. I would love to connect briefly if you have a moment.\n\nBest regards,\n[Your Name]`;

      const initialContent = `Subject: ${subject}\n\n${body}\n`;

      await docs.documents.batchUpdate({
        documentId,
        requestBody: {
          requests: [
            {
              insertText: {
                location: { index: 1 },
                text: initialContent,
              },
            },
          ],
        },
      });
    }

    // 6. Update Campaign Record and populate CampaignRecipients
    await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        googleSpreadsheetId: spreadsheetId,
        googleSpreadsheetUrl: spreadsheetUrl,
        googleDocId: documentId,
        googleDocUrl: documentUrl,
        status: 'prepared',
        totalRecipients: validRecipients.length,
      },
    });

    for (const c of validRecipients) {
      const idempotencyKey = crypto
        .createHash('sha256')
        .update(`${campaign.id}:${c.id}:${c.email}`)
        .digest('hex');

      await this.prisma.campaignRecipient.upsert({
        where: { idempotencyKey },
        update: {
          status: 'selected',
        },
        create: {
          campaignId: campaign.id,
          contactId: c.id,
          email: c.email,
          firstName: c.firstName,
          lastName: c.lastName,
          companyName: c.companyName,
          jobTitle: c.jobTitle,
          status: 'selected',
          idempotencyKey,
        },
      });
    }

    return {
      campaignId: campaign.id,
      spreadsheetId: spreadsheetId || '',
      spreadsheetUrl: spreadsheetUrl || '',
      documentId: documentId || '',
      documentUrl: documentUrl || '',
      recipientCount: validRecipients.length,
      skippedCount,
      warnings,
      mailmeteorInstructions: {
        step1: 'Click "Open Google Docs Template" above to view your personalized draft.',
        step2: 'In Google Docs top navigation, click: Extensions > Mailmeteor > New campaign (or use your installed Google Docs mail merge add-on).',
        step3: `Select your generated spreadsheet "${params.campaignName}" as the recipient data source.`,
        step4: 'Preview the merge variables ({{FirstName}}, {{Company}}) and click Send Campaign!',
      },
    };
  }
}
