import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { NativeGmailService } from '../services/gmail/gmail.service.js';
import { NativeGmailSendSchema } from '../models/validation.js';

export function createCampaignsRouter(
  prisma: PrismaClient,
  gmailService: NativeGmailService
): Router {
  const router = Router();

  /**
   * List all campaigns
   */
  router.get('/', async (_req, res, next) => {
    try {
      const campaigns = await prisma.campaign.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          template: true,
          _count: { select: { recipients: true } },
        },
      });
      res.json(campaigns);
    } catch (err) {
      next(err);
    }
  });

  /**
   * Get single campaign details with recipients
   */
  router.get('/:id', async (req, res, next) => {
    try {
      const campaign = await prisma.campaign.findUnique({
        where: { id: req.params.id },
        include: {
          template: true,
          recipients: {
            orderBy: { createdAt: 'asc' },
            include: { contact: true },
          },
        },
      });

      if (!campaign) {
        return res.status(404).json({ error: 'Campaign not found' });
      }

      res.json(campaign);
    } catch (err) {
      next(err);
    }
  });

  /**
   * Preview personalized messages for specific campaign recipients
   */
  router.post('/:id/preview', async (req, res, next) => {
    try {
      const { recipientIds, subjectTemplate, bodyTemplate } = req.body;
      const previews = await gmailService.previewPersonalizedMessages({
        campaignId: req.params.id,
        recipientIds: Array.isArray(recipientIds) ? recipientIds : [],
        subjectTemplate,
        bodyTemplate,
      });
      res.json(previews);
    } catch (err) {
      next(err);
    }
  });

  /**
   * Send or draft approved messages via native Gmail integration
   */
  router.post('/:id/dispatch', async (req, res, next) => {
    try {
      const { recipientIds, subjectTemplate, bodyTemplate, isDraftOnly, dailyCapOverride } = req.body;
      const parsed = NativeGmailSendSchema.parse({
        campaignId: req.params.id,
        recipientIds,
        isDraftOnly: Boolean(isDraftOnly),
        dailyCapOverride: dailyCapOverride ? Number(dailyCapOverride) : undefined,
      });

      const result = await gmailService.dispatchMessages({
        campaignId: parsed.campaignId,
        recipientIds: parsed.recipientIds,
        subjectTemplate,
        bodyTemplate,
        isDraftOnly: parsed.isDraftOnly,
        dailyCapOverride: parsed.dailyCapOverride,
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
