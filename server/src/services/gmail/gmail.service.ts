import { google } from 'googleapis';
import { PrismaClient } from '@prisma/client';
import { GoogleAuthService } from '../google/google-auth.service.js';
import { NormalizerService } from '../normalizer.service.js';
import { SuppressionService } from '../suppression.service.js';
import { logger } from '../../utils/logger.js';

export interface GmailDispatchResult {
  totalProcessed: number;
  sentCount: number;
  draftsCount: number;
  failedCount: number;
  skippedCount: number;
  errors: Array<{ email: string; reason: string }>;
}

export class NativeGmailService {
  private suppressionService: SuppressionService;

  constructor(
    private prisma: PrismaClient,
    private authService: GoogleAuthService
  ) {
    this.suppressionService = new SuppressionService(prisma);
  }

  /**
   * Previews personalized emails for selected recipients
   */
  async previewPersonalizedMessages(params: {
    campaignId: string;
    recipientIds: string[];
    subjectTemplate: string;
    bodyTemplate: string;
  }) {
    const recipients = await this.prisma.campaignRecipient.findMany({
      where: {
        campaignId: params.campaignId,
        id: { in: params.recipientIds },
      },
      include: { contact: true },
    });

    return recipients.map((r) => {
      const variables = {
        Email: r.email,
        FirstName: r.firstName || r.contact.firstName || '',
        LastName: r.lastName || r.contact.lastName || '',
        FullName: r.contact.fullName || `${r.firstName || ''} ${r.lastName || ''}`.trim(),
        Company: r.companyName || r.contact.companyName,
        JobTitle: r.jobTitle || r.contact.jobTitle || '',
        Role: r.contact.matchedRole || 'Opportunities',
        JobURL: r.jobUrl || '',
      };

      const rendered = NormalizerService.renderTemplate(
        params.subjectTemplate,
        params.bodyTemplate,
        variables
      );

      return {
        recipientId: r.id,
        contactId: r.contactId,
        email: r.email,
        fullName: variables.FullName,
        company: variables.Company,
        subject: rendered.subject,
        body: rendered.body,
        missingVariables: rendered.missingVariables,
      };
    });
  }

  /**
   * Sends or creates drafts for approved recipients via Gmail API
   */
  async dispatchMessages(params: {
    campaignId: string;
    recipientIds: string[];
    subjectTemplate?: string;
    bodyTemplate?: string;
    isDraftOnly?: boolean;
    dailyCapOverride?: number;
  }): Promise<GmailDispatchResult> {
    const auth = await this.authService.getAuthenticatedClient();
    const gmail = google.gmail({ version: 'v1', auth });

    const maxDailyCap =
      params.dailyCapOverride ||
      parseInt(process.env.DAILY_GMAIL_SEND_CAP || '30', 10);

    // Check how many messages were sent today across all campaigns
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const sentTodayCount = await this.prisma.campaignRecipient.count({
      where: {
        status: 'sent',
        sentAt: { gte: today },
      },
    });

    let allowedToSendToday = Math.max(0, maxDailyCap - sentTodayCount);
    if (!params.isDraftOnly && allowedToSendToday <= 0) {
      throw new Error(
        `Application daily sending limit reached (${sentTodayCount}/${maxDailyCap} emails sent today). Switch to 'Create Drafts' or increase your cap in Settings.`
      );
    }

    const recipients = await this.prisma.campaignRecipient.findMany({
      where: {
        campaignId: params.campaignId,
        id: { in: params.recipientIds },
      },
      include: { contact: true, campaign: { include: { template: true } } },
    });

    const result: GmailDispatchResult = {
      totalProcessed: recipients.length,
      sentCount: 0,
      draftsCount: 0,
      failedCount: 0,
      skippedCount: 0,
      errors: [],
    };

    for (const r of recipients) {
      // 1. Check idempotency: Never send twice
      if (r.status === 'sent') {
        result.skippedCount++;
        result.errors.push({ email: r.email, reason: 'Already sent previously (idempotency guard).' });
        continue;
      }

      // 2. Check suppression
      const suppression = await this.suppressionService.isSuppressed(r.email);
      if (suppression.suppressed) {
        result.skippedCount++;
        result.errors.push({ email: r.email, reason: `Suppressed: ${suppression.reason}` });
        await this.prisma.campaignRecipient.update({
          where: { id: r.id },
          data: { status: 'suppressed' },
        });
        continue;
      }

      // 3. Render Personalized Content
      const subjectTpl =
        params.subjectTemplate ||
        r.campaign.template?.subject ||
        'Reaching out regarding {{Role}} opportunities at {{Company}}';
      const bodyTpl =
        params.bodyTemplate ||
        r.campaign.template?.bodyText ||
        'Hi {{FirstName}},\n\nI noticed your work at {{Company}} and wanted to connect.\n\nBest,\n[Your Name]';

      const variables = {
        Email: r.email,
        FirstName: r.firstName || r.contact.firstName || '',
        LastName: r.lastName || r.contact.lastName || '',
        FullName: r.contact.fullName || `${r.firstName || ''} ${r.lastName || ''}`.trim(),
        Company: r.companyName || r.contact.companyName,
        JobTitle: r.jobTitle || r.contact.jobTitle || '',
        Role: r.contact.matchedRole || 'Opportunities',
        JobURL: r.jobUrl || '',
      };

      const rendered = NormalizerService.renderTemplate(subjectTpl, bodyTpl, variables);

      // Build RFC 2822 email string
      const rawEmail = [
        `To: ${r.email}`,
        `Subject: =?utf-8?B?${Buffer.from(rendered.subject).toString('base64')}?=`,
        'Content-Type: text/plain; charset=utf-8',
        'MIME-Version: 1.0',
        '',
        rendered.body,
      ].join('\r\n');

      const encodedMessage = Buffer.from(rawEmail)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      try {
        if (params.isDraftOnly) {
          // Create Draft
          const draftRes = await gmail.users.drafts.create({
            userId: 'me',
            requestBody: {
              message: { raw: encodedMessage },
            },
          });

          await this.prisma.campaignRecipient.update({
            where: { id: r.id },
            data: {
              status: 'draft_created',
              gmailDraftId: draftRes.data.id,
              personalizedSubject: rendered.subject,
              personalizedBody: rendered.body,
            },
          });

          result.draftsCount++;
        } else {
          // Check daily limit allowance
          if (allowedToSendToday <= 0) {
            result.skippedCount++;
            result.errors.push({
              email: r.email,
              reason: `Daily sending cap (${maxDailyCap}) reached during run.`,
            });
            break;
          }

          // Individual Discrete Send (Never mass-to)
          const sendRes = await gmail.users.messages.send({
            userId: 'me',
            requestBody: { raw: encodedMessage },
          });

          allowedToSendToday--;

          await this.prisma.campaignRecipient.update({
            where: { id: r.id },
            data: {
              status: 'sent',
              sentAt: new Date(),
              gmailMessageId: sendRes.data.id,
              personalizedSubject: rendered.subject,
              personalizedBody: rendered.body,
            },
          });

          await this.prisma.contact.update({
            where: { id: r.contactId },
            data: { outreachState: 'sent' },
          });

          result.sentCount++;
        }
      } catch (sendErr: any) {
        logger.error(`Gmail dispatch failed for ${r.email}`, sendErr);
        result.failedCount++;
        result.errors.push({ email: r.email, reason: sendErr.message });

        await this.prisma.campaignRecipient.update({
          where: { id: r.id },
          data: {
            status: 'failed',
            errorMessage: sendErr.message,
          },
        });
      }
    }

    // Update campaign counters
    await this.prisma.campaign.update({
      where: { id: params.campaignId },
      data: {
        sentCount: { increment: result.sentCount },
        failedCount: { increment: result.failedCount },
      },
    });

    return result;
  }
}
