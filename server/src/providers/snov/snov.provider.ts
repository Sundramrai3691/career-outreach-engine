import { IContactProvider, fetchWithRetry } from '../base.provider.js';
import {
  ProviderName,
  ProviderHealthResult,
  ProviderUsageResult,
  ProviderPersonResult,
  ProviderContactResult,
  ProviderEnrichResult,
  ProviderEmailResult,
  ProviderVerificationResult,
  EmailVerificationStatus,
} from '../../models/types.js';
import { logger } from '../../utils/logger.js';

export class SnovProvider implements IContactProvider {
  readonly name: ProviderName = 'snov';
  private clientId: string;
  private clientSecret: string;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  private baseUrl = 'https://api.snov.io';
  private lastError: string | null = null;

  constructor(clientId?: string, clientSecret?: string) {
    this.clientId = clientId || process.env.SNOV_CLIENT_ID || '';
    this.clientSecret = clientSecret || process.env.SNOV_CLIENT_SECRET || '';
  }

  getLastError(): string | null {
    return this.lastError;
  }

  clearLastError(): void {
    this.lastError = null;
  }

  setCredentials(clientId: string, clientSecret: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.accessToken = null;
    this.tokenExpiresAt = 0;
  }

  private async getAccessToken(): Promise<string | null> {
    if (!this.clientId || !this.clientSecret) return null;
    const now = Date.now();
    if (this.accessToken && this.tokenExpiresAt > now + 60000) {
      return this.accessToken;
    }

    try {
      const res = await fetchWithRetry(`${this.baseUrl}/v1/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: this.clientId,
          client_secret: this.clientSecret,
        }),
      });

      if (!res.ok) {
        logger.error(`Snov OAuth token request failed: ${res.status}`);
        return null;
      }

      const data = (await res.json()) as any;
      this.accessToken = data.access_token;
      this.tokenExpiresAt = now + (data.expires_in || 3600) * 1000;
      return this.accessToken;
    } catch (err: any) {
      logger.error('Snov OAuth error', { message: err.message });
      return null;
    }
  }

  async healthCheck(): Promise<ProviderHealthResult> {
    if (!this.clientId || !this.clientSecret) {
      return {
        healthy: false,
        authenticated: false,
        canSearch: false,
        status: 'missing_credentials',
        provider: this.name,
        message: 'Snov.io API client credentials (User ID and Secret) not configured.',
        nextAction: 'Configure SNOV_CLIENT_ID and SNOV_CLIENT_SECRET in Settings or .env.',
      };
    }

    const start = Date.now();
    const token = await this.getAccessToken();
    if (!token) {
      return {
        healthy: false,
        authenticated: false,
        canSearch: false,
        status: 'auth_failed',
        provider: this.name,
        message: 'Snov.io authentication failed: unable to obtain OAuth token.',
        authMessage: 'OAuth Token Failed',
        nextAction: 'Verify your Snov User ID and Secret in Settings.',
        latencyMs: Date.now() - start,
      };
    }

    return {
      healthy: true,
      authenticated: true,
      canSearch: true,
      status: 'operational',
      provider: this.name,
      message: 'Snov.io authenticated successfully via OAuth 2.0.',
      authMessage: 'OAuth 2.0 Authenticated',
      latencyMs: Date.now() - start,
    };
  }

  async getUsage(): Promise<ProviderUsageResult> {
    const token = await this.getAccessToken();
    if (!token) return { creditsUsed: 0 };

    try {
      const res = await fetchWithRetry(`${this.baseUrl}/v1/get-user-balance`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (res.ok) {
        const data = (await res.json()) as any;
        return {
          creditsUsed: 0,
          creditsRemaining: data?.balance || 0,
        };
      }
    } catch (err) {
      logger.warn('Failed to get Snov balance', err);
    }

    return { creditsUsed: 0 };
  }

  async searchPeople(_domain: string, _roles: string[]): Promise<ProviderPersonResult[]> {
    return [];
  }

  async searchDomainContacts(domain: string, _roles: string[]): Promise<ProviderContactResult[]> {
    const token = await this.getAccessToken();
    if (!token) return [];

    try {
      const res = await fetchWithRetry(`${this.baseUrl}/v2/domain-emails-with-info`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ domain, type: 'all', limit: 20 }),
      });

      if (!res.ok) return [];
      const data = (await res.json()) as any;
      const emails = data?.emails || [];

      return emails.map((item: any) => {
        let status: EmailVerificationStatus = 'unverified';
        if (item.status === 'valid') status = 'verified';
        else if (item.status === 'invalid') status = 'invalid';
        else if (item.status === 'catch_all') status = 'accept_all';

        return {
          email: item.email,
          firstName: item.firstName,
          lastName: item.lastName,
          fullName: `${item.firstName || ''} ${item.lastName || ''}`.trim(),
          position: item.position,
          domain: domain,
          status,
          raw: item,
        };
      });
    } catch (err: any) {
      logger.warn('Snov searchDomainContacts failed', { message: err.message });
      return [];
    }
  }

  async enrichPerson(_details: any): Promise<ProviderEnrichResult> {
    return { success: false };
  }

  async findEmail(_domain: string, _firstName: string, _lastName: string): Promise<ProviderEmailResult> {
    return { found: false, status: 'unavailable' };
  }

  async verifyEmail(_email: string): Promise<ProviderVerificationResult> {
    return {
      status: 'unknown',
      score: 50,
      smtpCheck: false,
      mxCheck: true,
      isCatchAll: false,
      isDisposable: false,
    };
  }
}
