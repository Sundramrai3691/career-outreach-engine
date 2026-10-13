import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import { ZodError } from 'zod';

import { DiscoveryOrchestrator } from './services/contact-discovery/discovery.orchestrator.js';
import { GoogleAuthService } from './services/google/google-auth.service.js';
import { GoogleWorkspaceService } from './services/google/google.service.js';
import { NativeGmailService } from './services/gmail/gmail.service.js';

import { createDiscoveryRouter } from './routes/discovery.routes.js';
import { createContactsRouter } from './routes/contacts.routes.js';
import { createTemplatesRouter } from './routes/templates.routes.js';
import { createGoogleRouter } from './routes/google.routes.js';
import { createCampaignsRouter } from './routes/campaigns.routes.js';
import { createSettingsRouter } from './routes/settings.routes.js';
import { logger } from './utils/logger.js';

export function createApp(prismaClient?: PrismaClient, customOrchestrator?: DiscoveryOrchestrator) {
  const app = express();
  const prisma = prismaClient || new PrismaClient();

  const orchestrator = customOrchestrator || new DiscoveryOrchestrator(prisma);
  const googleAuth = new GoogleAuthService(prisma);
  const workspace = new GoogleWorkspaceService(prisma, googleAuth);
  const gmail = new NativeGmailService(prisma, googleAuth);

  app.use(
    cors({
      origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
      credentials: true,
    })
  );

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Health route
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      service: 'referral-engine-api',
      timestamp: new Date().toISOString(),
    });
  });

  // Dashboard Stats summary route
  app.get('/api/dashboard/stats', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [totalContacts, verifiedContacts, totalCampaigns, sentRecipients, recentRuns] =
        await Promise.all([
          prisma.contact.count(),
          prisma.contact.count({ where: { emailStatus: 'verified' } }),
          prisma.campaign.count(),
          prisma.campaignRecipient.count({ where: { status: 'sent' } }),
          prisma.discoveryRun.findMany({
            take: 5,
            orderBy: { startedAt: 'desc' },
          }),
        ]);

      res.json({
        totalContacts,
        verifiedContacts,
        totalCampaigns,
        sentRecipients,
        recentRuns,
      });
    } catch (err) {
      next(err);
    }
  });

  // Mount API routers
  app.use('/api/discovery', createDiscoveryRouter(prisma, orchestrator));
  app.use('/api/contacts', createContactsRouter(prisma));
  app.use('/api/templates', createTemplatesRouter(prisma));
  app.use('/api/google', createGoogleRouter(googleAuth, workspace));
  app.use('/api/campaigns', createCampaignsRouter(prisma, gmail));
  app.use('/api/settings', createSettingsRouter(prisma));

  // Centralized Error Handling Middleware
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    logger.error('Unhandled API Error', err);

    if (err instanceof ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: err.errors.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
        })),
      });
    }

    const statusCode = err.status || err.statusCode || 500;
    const message = err.message || 'An unexpected internal error occurred.';

    res.status(statusCode).json({
      error: message,
      status: statusCode,
    });
  });

  return { app, prisma };
}
