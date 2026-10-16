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

export class HunterProvider implements IContactProvider {
  readonly name: ProviderName = 'hunter';
  private apiKey: string;
  private baseUrl = 'https://api.hunter.io/v2';

  private lastError: string | null = null;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.HUNTER_API_KEY || '';
  }

  getLastError(): string | null {
    return this.lastError;
  }

  clearLastError(): void {
    this.lastError = null;
  }

  setApiKey(key: string) {
    this.apiKey = key;
  }

  async healthCheck(): Promise<ProviderHealthResult> {
    if (!this.apiKey) {
      return {
        healthy: false,
        authenticated: false,
        canSearch: false,
        status: 'missing_credentials',
        provider: this.name,
        message: 'Hunter API key is missing. Set HUNTER_API_KEY in .env or configure in Settings.',
        nextAction: 'Set HUNTER_API_KEY in .env or Settings, or use CSV Import / Mock Simulator.',
      };
    }

    const start = Date.now();
    try {
      const res = await fetchWithRetry(`${this.baseUrl}/account?api_key=${encodeURIComponent(this.apiKey)}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });

      if (res.status === 401) {
        return {
          healthy: false,
          authenticated: false,
          canSearch: false,
          status: 'auth_failed',
          provider: this.name,
          message: 'Hunter authentication failed: invalid or expired API key (HTTP 401).',
          authMessage: 'Invalid API Key',
          nextAction: 'Verify and update your HUNTER_API_KEY in Settings or .env.',
          latencyMs: Date.now() - start,
        };
      }

      if (res.ok) {
        const body = (await res.json()) as any;
        const plan = body?.data?.plan_name || 'Active';

        // Probe search endpoint to check for account restrictions
        try {
          const probe = await fetchWithRetry(`${this.baseUrl}/domain-search?domain=stripe.com&limit=1&api_key=${encodeURIComponent(this.apiKey)}`, {
            method: 'GET',
          });
          if (probe.status === 429) {
            const probeData = (await probe.json().catch(() => ({}))) as any;
            const details = probeData?.errors?.[0]?.details || 'Your account was restricted. Please log in to Hunter for more information.';
            return {
              healthy: false,
              authenticated: true,
              canSearch: false,
              status: 'account_restricted',
              provider: this.name,
              message: `API Key Valid, but Account is Restricted (HTTP 429): ${details}`,
              authMessage: 'Valid API Key (Authenticated)',
              restrictionReason: `Account Restriction: ${details}`,
              nextAction: 'Log in to hunter.io to resolve account restriction, or use CSV Import / Official Web Fallback / Mock Simulator.',
              latencyMs: Date.now() - start,
            };
          }
        } catch {
          // Probe error non-fatal if account check passed
        }

        return {
          healthy: true,
          authenticated: true,
          canSearch: true,
          status: 'operational',
          provider: this.name,
          message: `Hunter connected and operational (${plan} plan).`,
          authMessage: 'Valid API Key (Authenticated)',
          latencyMs: Date.now() - start,
        };
      }

      return {
        healthy: false,
        authenticated: false,
        canSearch: false,
        status: 'error',
        provider: this.name,
        message: `Hunter responded with HTTP ${res.status}`,
        latencyMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        healthy: false,
        authenticated: false,
        canSearch: false,
        status: 'error',
        provider: this.name,
        message: `Hunter network error: ${err.message}`,
        latencyMs: Date.now() - start,
      };
    }
  }

  async getUsage(): Promise<ProviderUsageResult> {
    if (!this.apiKey) {
      return { creditsUsed: 0, creditsRemaining: 0 };
    }

    try {
      const res = await fetchWithRetry(`${this.baseUrl}/account?api_key=${encodeURIComponent(this.apiKey)}`, {
        method: 'GET',
      });

      if (res.ok) {
        const body = (await res.json()) as any;
        const data = body.data;
        const searches = data?.requests?.searches || {};
        return {
          planName: data?.plan_name,
          creditsUsed: searches.used || 0,
          creditsRemaining: searches.available ? searches.available - (searches.used || 0) : undefined,
        };
      }
    } catch (err) {
      logger.warn('Failed to retrieve Hunter usage', err);
    }

    return { creditsUsed: 0 };
  }

  async searchPeople(_domain: string, _roles: string[]): Promise<ProviderPersonResult[]> {
    return [];
  }

  /**
   * Stage C: Search domain contacts from public web indexing
   */
  async searchDomainContacts(domain: string, _roles: string[]): Promise<ProviderContactResult[]> {
    this.lastError = null;
    if (!this.apiKey) {
      this.lastError = 'Hunter API key missing';
      return [];
    }

    const url = `${this.baseUrl}/domain-search?domain=${encodeURIComponent(domain)}&type=personal&limit=25&api_key=${encodeURIComponent(this.apiKey)}`;

    try {
      const res = await fetchWithRetry(url, { method: 'GET' });
      if (!res.ok) {
        if (res.status === 429) {
          try {
            const probeData = (await res.json().catch(() => ({}))) as any;
            const details = probeData?.errors?.[0]?.details || 'Your account was restricted. Log in to Hunter to resolve.';
            this.lastError = `Hunter account restricted: ${details}`;
          } catch {
            this.lastError = 'Hunter account restricted (HTTP 429).';
          }
        } else if (res.status === 401) {
          this.lastError = 'Hunter authentication failed: invalid API key.';
        } else {
          this.lastError = `Hunter domain-search returned status ${res.status}`;
        }
        logger.warn(`Hunter domain-search failed: ${this.lastError}`);
        return [];
      }

      const body = (await res.json()) as any;
      const emails = body.data?.emails || [];

      return emails.map((item: any) => {
        let status: EmailVerificationStatus = 'unverified';
        if (item.verification?.status === 'valid') status = 'verified';
        else if (item.verification?.status === 'accept_all') status = 'accept_all';
        else if (item.verification?.status === 'invalid') status = 'invalid';

        return {
          email: item.value,
          firstName: item.first_name,
          lastName: item.last_name,
          fullName: `${item.first_name || ''} ${item.last_name || ''}`.trim(),
          position: item.position,
          domain: domain,
          companyName: body.data?.organization || domain,
          confidence: item.confidence,
          status,
          sources: (item.sources || []).map((s: any) => ({
            domain: s.domain,
            uri: s.uri,
            extractedOn: s.extracted_on,
          })),
          raw: item,
        };
      });
    } catch (err: any) {
      this.lastError = `Hunter network error: ${err.message}`;
      logger.error('Hunter domain-search failed', { error: err.message });
      return [];
    }
  }

  async enrichPerson(_details: any): Promise<ProviderEnrichResult> {
    return { success: false };
  }

  /**
   * Finds specific email when name and domain are known
   */
  async findEmail(domain: string, firstName: string, lastName: string): Promise<ProviderEmailResult> {
    this.lastError = null;
    if (!this.apiKey) {
      this.lastError = 'Hunter API key missing';
      return { found: false, status: 'unavailable' };
    }

    const url = `${this.baseUrl}/email-finder?domain=${encodeURIComponent(domain)}&first_name=${encodeURIComponent(firstName)}&last_name=${encodeURIComponent(lastName)}&api_key=${encodeURIComponent(this.apiKey)}`;

    try {
      const res = await fetchWithRetry(url, { method: 'GET' });
      if (!res.ok) {
        if (res.status === 429) {
          this.lastError = 'Hunter account restricted (HTTP 429).';
        } else {
          this.lastError = `Hunter email-finder returned status ${res.status}`;
        }
        return { found: false, status: 'unavailable' };
      }

      const body = (await res.json()) as any;
      const email = body.data?.email;
      if (!email) {
        return { found: false, status: 'unavailable', creditsConsumed: 0 };
      }

      let status: EmailVerificationStatus = 'unverified';
      if (body.data?.verification?.status === 'valid') status = 'verified';
      else if (body.data?.verification?.status === 'accept_all') status = 'accept_all';

      return {
        found: true,
        email,
        score: body.data?.score,
        status,
        sources: body.data?.sources,
        creditsConsumed: 1,
        raw: body.data,
      };
    } catch (err: any) {
      logger.error('Hunter email-finder network error', { error: err.message });
      return { found: false, status: 'unavailable' };
    }
  }

  /**
   * Verifies deliverability of an email
   */
  async verifyEmail(email: string): Promise<ProviderVerificationResult> {
    if (!this.apiKey) {
      return {
        status: 'unknown',
        score: 50,
        smtpCheck: false,
        mxCheck: true,
        isCatchAll: false,
        isDisposable: false,
      };
    }

    const url = `${this.baseUrl}/email-verifier?email=${encodeURIComponent(email)}&api_key=${encodeURIComponent(this.apiKey)}`;

    try {
      const res = await fetchWithRetry(url, { method: 'GET' });
      if (!res.ok) {
        return {
          status: 'unknown',
          score: 50,
          smtpCheck: false,
          mxCheck: true,
          isCatchAll: false,
          isDisposable: false,
        };
      }

      const body = (await res.json()) as any;
      const data = body.data || {};

      let status: EmailVerificationStatus = 'unknown';
      if (data.status === 'valid') status = 'verified';
      else if (data.status === 'invalid') status = 'invalid';
      else if (data.status === 'accept_all') status = 'accept_all';
      else if (data.status === 'disposable') status = 'invalid';

      return {
        status,
        score: data.score || 0,
        smtpCheck: data.smtp_check === 'true' || data.smtp_check === true,
        mxCheck: data.mx_records === 'true' || data.mx_records === true,
        isCatchAll: data.accept_all === true,
        isDisposable: data.disposable === true,
        raw: data,
      };
    } catch (err: any) {
      logger.error('Hunter verifyEmail failed', { error: err.message });
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
}
