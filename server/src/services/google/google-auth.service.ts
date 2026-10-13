import { google } from 'googleapis';
import { PrismaClient } from '@prisma/client';
import { encryptSecret, decryptSecret, generateCsrfToken } from '../../utils/crypto.js';
import { logger } from '../../utils/logger.js';

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/gmail.compose',
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

export class GoogleAuthService {
  private oauth2Client: any;
  private stateTokens = new Map<string, number>();

  constructor(private prisma: PrismaClient) {
    const clientId = process.env.GOOGLE_CLIENT_ID || '';
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/google/oauth2callback';

    this.oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  }

  isConfigured(): boolean {
    return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  }

  /**
   * Generates authorization URL with CSRF state protection
   */
  generateAuthUrl(): { url: string; state: string } {
    const state = generateCsrfToken();
    this.stateTokens.set(state, Date.now() + 10 * 60 * 1000); // 10 min expiry

    const url = this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: GOOGLE_SCOPES,
      state,
    });

    return { url, state };
  }

  /**
   * Handles callback, validates state token, exchanges code for encrypted credentials
   */
  async handleCallback(code: string, state: string): Promise<{ email: string; name?: string }> {
    const expiry = this.stateTokens.get(state);
    if (!expiry || expiry < Date.now()) {
      throw new Error('Invalid or expired OAuth state token (CSRF protection failed).');
    }
    this.stateTokens.delete(state);

    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);

    // Fetch user profile info
    const oauth2 = google.oauth2({ version: 'v2', auth: this.oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const email = userInfo.data.email!;
    const name = userInfo.data.name || undefined;
    const picture = userInfo.data.picture || undefined;

    // Encrypt tokens before storing at rest
    const encryptedAccessToken = encryptSecret(tokens.access_token || '');
    const encryptedRefreshToken = encryptSecret(tokens.refresh_token || '');

    await this.prisma.googleConnection.upsert({
      where: { email },
      update: {
        name,
        picture,
        encryptedAccessToken,
        ...(tokens.refresh_token ? { encryptedRefreshToken } : {}),
        tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
        scopesJson: JSON.stringify(GOOGLE_SCOPES),
        status: 'connected',
      },
      create: {
        email,
        name,
        picture,
        encryptedAccessToken,
        encryptedRefreshToken,
        tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
        scopesJson: JSON.stringify(GOOGLE_SCOPES),
        status: 'connected',
      },
    });

    logger.info(`Google account ${email} connected successfully.`);
    return { email, name };
  }

  /**
   * Retrieves an authenticated OAuth2 client with auto-refresh
   */
  async getAuthenticatedClient(): Promise<any> {
    const connection = await this.prisma.googleConnection.findFirst({
      where: { status: 'connected' },
      orderBy: { updatedAt: 'desc' },
    });

    if (!connection) {
      throw new Error('No connected Google account found. Please connect your Google account in Settings.');
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;

    const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    const accessToken = decryptSecret(connection.encryptedAccessToken);
    const refreshToken = decryptSecret(connection.encryptedRefreshToken);

    auth.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
      expiry_date: connection.tokenExpiry?.getTime(),
    });

    // Check if token expires soon (within 5 minutes)
    const isExpiringSoon = connection.tokenExpiry && connection.tokenExpiry.getTime() - Date.now() < 300000;
    if (isExpiringSoon && refreshToken) {
      try {
        const { credentials } = await auth.refreshAccessToken();
        const updatedEncryptedAccess = encryptSecret(credentials.access_token || '');
        await this.prisma.googleConnection.update({
          where: { id: connection.id },
          data: {
            encryptedAccessToken: updatedEncryptedAccess,
            tokenExpiry: credentials.expiry_date ? new Date(credentials.expiry_date) : undefined,
          },
        });
        auth.setCredentials(credentials);
      } catch (err) {
        logger.error('Failed to refresh Google access token', err);
        await this.prisma.googleConnection.update({
          where: { id: connection.id },
          data: { status: 'expired' },
        });
        throw new Error('Google authorization expired or revoked. Please reconnect your account.');
      }
    }

    return auth;
  }

  /**
   * Retrieves status of current connection without leaking secrets
   */
  async getConnectionStatus() {
    const connection = await this.prisma.googleConnection.findFirst({
      where: { status: 'connected' },
      orderBy: { updatedAt: 'desc' },
    });

    return {
      isConfigured: this.isConfigured(),
      isConnected: Boolean(connection),
      account: connection
        ? {
            email: connection.email,
            name: connection.name,
            picture: connection.picture,
            status: connection.status,
            connectedAt: connection.createdAt,
          }
        : null,
    };
  }

  /**
   * Disconnects and removes stored credentials
   */
  async disconnect(): Promise<void> {
    await this.prisma.googleConnection.deleteMany();
    logger.info('Google account disconnected and tokens purged from database.');
  }
}
