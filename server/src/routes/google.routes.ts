import { Router } from 'express';
import { GoogleAuthService } from '../services/google/google-auth.service.js';
import { GoogleWorkspaceService } from '../services/google/google.service.js';
import { PrepareGoogleMailMergeSchema } from '../models/validation.js';

export function createGoogleRouter(
  authService: GoogleAuthService,
  workspaceService: GoogleWorkspaceService
): Router {
  const router = Router();

  /**
   * Get current Google connection status
   */
  router.get('/status', async (_req, res, next) => {
    try {
      const status = await authService.getConnectionStatus();
      res.json(status);
    } catch (err) {
      next(err);
    }
  });

  /**
   * Generate OAuth URL
   */
  router.get('/auth-url', (_req, res, next) => {
    try {
      if (!authService.isConfigured()) {
        return res.status(400).json({
          error: 'Google OAuth credentials (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET) are not configured on the server.',
        });
      }
      const auth = authService.generateAuthUrl();
      res.json(auth);
    } catch (err) {
      next(err);
    }
  });

  /**
   * OAuth Callback
   */
  router.get('/oauth2callback', async (req, res) => {
    try {
      const { code, state, error } = req.query as Record<string, string>;

      const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5174';

      if (error) {
        return res.redirect(`${clientOrigin}/settings?google_error=${encodeURIComponent(error)}`);
      }

      if (!code || !state) {
        return res.status(400).send('Missing code or state parameter');
      }

      await authService.handleCallback(code, state);
      res.redirect(`${clientOrigin}/settings?google_success=true`);
    } catch (err: any) {
      const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5174';
      res.redirect(
        `${clientOrigin}/settings?google_error=${encodeURIComponent(err.message)}`
      );
    }
  });

  /**
   * Disconnect account
   */
  router.post('/disconnect', async (_req, res, next) => {
    try {
      await authService.disconnect();
      res.json({ success: true, message: 'Google account disconnected successfully.' });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Prepare Google Mail Merge (Create Sheets and Docs template)
   */
  router.post('/prepare-mail-merge', async (req, res, next) => {
    try {
      const parsed = PrepareGoogleMailMergeSchema.parse(req.body);
      const result = await workspaceService.prepareGoogleMailMerge(parsed);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
