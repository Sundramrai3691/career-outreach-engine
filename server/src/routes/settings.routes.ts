import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { TombaProvider } from '../providers/tomba/tomba.provider.js';
import { ApolloProvider } from '../providers/apollo/apollo.provider.js';
import { HunterProvider } from '../providers/hunter/hunter.provider.js';
import { SnovProvider } from '../providers/snov/snov.provider.js';
import { MockProvider } from '../providers/mock/mock.provider.js';
import { OfficialWebProvider } from '../providers/official-web/official-web.provider.js';
import { encryptSecret } from '../utils/crypto.js';
import { SuppressionService } from '../services/suppression.service.js';
import { SuppressionInputSchema } from '../models/validation.js';
import { CredentialResolver } from '../config/credential-resolver.js';
import { ProviderName } from '../models/types.js';

export function createSettingsRouter(prisma: PrismaClient): Router {
  const router = Router();
  const suppressionService = new SuppressionService(prisma);
  const resolver = new CredentialResolver(prisma);

  /**
   * Get all provider settings and health statuses
   */
  router.get('/', async (_req, res, next) => {
    try {
      const dbSettings = await prisma.providerSetting.findMany();
      const providers: ProviderName[] = ['tomba', 'apollo', 'hunter', 'snov', 'official_website', 'mock'];

      const results = await Promise.all(
        providers.map(async (key) => {
          const setting = dbSettings.find((s) => s.providerKey === key);
          const resolved = await resolver.resolve(key);

          return {
            key,
            isEnabled: setting ? setting.isEnabled : true,
            priority: setting
              ? setting.priority
              : key === 'tomba'
              ? 1
              : key === 'apollo'
              ? 2
              : key === 'hunter'
              ? 3
              : key === 'snov'
              ? 4
              : 5,
            hasKey: resolved.isConfigured,
            isConfigured: resolved.isConfigured,
            source: resolved.source,
            missingEnvVar: resolved.missingEnvVar,
            spendingCap: setting?.spendingCap ?? null,
            creditsUsed: setting?.creditsUsed ?? 0,
            healthStatus: setting?.healthStatus ?? 'unknown',
            lastErrorMessage: setting?.lastErrorMessage ?? null,
            lastHealthCheck: setting?.lastHealthCheck ?? null,
          };
        })
      );

      res.json({
        providers: results,
        dailySendCap: parseInt(process.env.DAILY_GMAIL_SEND_CAP || '30', 10),
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Update a provider's settings or key
   */
  router.post('/providers/:key', async (req, res, next) => {
    try {
      const key = req.params.key;
      const { isEnabled, priority, apiKey, secret, spendingCap } = req.body;

      const data: any = {};
      if (typeof isEnabled === 'boolean') data.isEnabled = isEnabled;
      if (typeof priority === 'number') data.priority = priority;
      if (typeof spendingCap === 'number' || spendingCap === null) data.spendingCap = spendingCap;

      if (typeof apiKey === 'string') {
        if (apiKey.trim().length > 0) {
          data.encryptedApiKey = encryptSecret(apiKey.trim());
        } else {
          data.encryptedApiKey = null;
        }
      }

      if (typeof secret === 'string') {
        if (secret.trim().length > 0) {
          data.encryptedSecret = encryptSecret(secret.trim());
        } else {
          data.encryptedSecret = null;
        }
      }

      const updated = await prisma.providerSetting.upsert({
        where: { providerKey: key },
        update: data,
        create: {
          providerKey: key,
          ...data,
        },
      });

      res.json({ success: true, setting: updated });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Run live health check for a provider
   */
  router.post('/providers/:key/health-check', async (req, res, next) => {
    try {
      const key = req.params.key as ProviderName;
      const resolved = await resolver.resolve(key);

      let provider;
      if (key === 'tomba') provider = new TombaProvider(resolved.apiKey, resolved.secret);
      else if (key === 'apollo') provider = new ApolloProvider(resolved.apiKey);
      else if (key === 'hunter') provider = new HunterProvider(resolved.apiKey);
      else if (key === 'snov') provider = new SnovProvider(resolved.apiKey, resolved.secret);
      else if (key === 'official_website') provider = new OfficialWebProvider();
      else provider = new MockProvider();

      const health = await provider.healthCheck();

      const healthStatus = health.status || (health.healthy ? 'healthy' : 'error');

      await prisma.providerSetting.upsert({
        where: { providerKey: key },
        update: {
          healthStatus,
          lastHealthCheck: new Date(),
          lastErrorMessage: health.healthy ? null : health.message,
        },
        create: {
          providerKey: key,
          healthStatus,
          lastHealthCheck: new Date(),
          lastErrorMessage: health.healthy ? null : health.message,
        },
      });

      res.json({
        ...health,
        source: resolved.source,
        isConfigured: resolved.isConfigured,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Get suppression list
   */
  router.get('/suppressions', async (_req, res, next) => {
    try {
      const list = await suppressionService.getAllSuppressed();
      res.json(list);
    } catch (err) {
      next(err);
    }
  });

  /**
   * Add to suppression list
   */
  router.post('/suppressions', async (req, res, next) => {
    try {
      const parsed = SuppressionInputSchema.parse(req.body);
      await suppressionService.suppressEmail(parsed.email, parsed.reason, parsed.notes);
      res.status(201).json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
