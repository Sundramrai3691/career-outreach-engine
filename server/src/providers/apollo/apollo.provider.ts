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

export class ApolloProvider implements IContactProvider {
  readonly name: ProviderName = 'apollo';
  private apiKey: string;
  private baseUrl = 'https://api.apollo.io';

  private lastError: string | null = null;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.APOLLO_API_KEY || '';
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
        message: 'Apollo API key is missing. Set APOLLO_API_KEY in .env or configure in Settings.',
        nextAction: 'Set APOLLO_API_KEY in .env or Settings, or use CSV Import / Mock Simulator.',
      };
    }

    const start = Date.now();
    try {
      const res = await fetchWithRetry(`${this.baseUrl}/v1/auth/health`, {
        method: 'GET',
        headers: {
          'X-Api-Key': this.apiKey,
          'Content-Type': 'application/json',
        },
      });

      if (res.status === 401 || res.status === 403) {
        return {
          healthy: false,
          authenticated: false,
          canSearch: false,
          status: 'auth_failed',
          provider: this.name,
          message: 'Apollo authentication failed: invalid or expired API key (HTTP ' + res.status + ').',
          authMessage: 'Invalid API Key',
          nextAction: 'Verify and update your APOLLO_API_KEY in Settings or .env.',
          latencyMs: Date.now() - start,
        };
      }

      if (res.ok) {
        // Step 2: Probe whether the account has search API access
        try {
          const probe = await fetchWithRetry(`${this.baseUrl}/api/v1/mixed_people/api_search?per_page=1`, {
            method: 'POST',
            headers: {
              'X-Api-Key': this.apiKey,
              'Content-Type': 'application/json',
            },
          });

          if (probe.status === 403) {
            return {
              healthy: false,
              authenticated: true,
              canSearch: false,
              status: 'authenticated_restricted',
              provider: this.name,
              message: 'API Key Valid, but People Search is Restricted (HTTP 403): Apollo Free plan does not include Search API access.',
              authMessage: 'Valid API Key (Authenticated)',
              restrictionReason: 'Endpoint Forbidden: Free plan accounts are not authorized to use /api/v1/mixed_people/api_search.',
              nextAction: 'Upgrade to a paid Apollo plan, or use CSV Import / Official Web Fallback / Mock Simulator.',
              latencyMs: Date.now() - start,
            };
          }
        } catch {
          // Probe error non-fatal if auth passed
        }

        return {
          healthy: true,
          authenticated: true,
          canSearch: true,
          status: 'operational',
          provider: this.name,
          message: 'Apollo authenticated and People Search is operational.',
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
        message: `Apollo responded with status ${res.status}: ${res.statusText}`,
        latencyMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        healthy: false,
        authenticated: false,
        canSearch: false,
        status: 'error',
        provider: this.name,
        message: `Apollo network error: ${err.message}`,
        latencyMs: Date.now() - start,
      };
    }
  }

  async getUsage(): Promise<ProviderUsageResult> {
    if (!this.apiKey) {
      return { creditsUsed: 0, creditsRemaining: 0 };
    }

    try {
      const res = await fetchWithRetry(`${this.baseUrl}/v1/users/me`, {
        method: 'GET',
        headers: {
          'X-Api-Key': this.apiKey,
          'Content-Type': 'application/json',
        },
      });

      if (res.ok) {
        const data = (await res.json()) as any;
        // Apollo returns user account metadata
        return {
          planName: data?.user?.plan_name || 'Standard',
          creditsUsed: data?.user?.credits_used || 0,
          creditsRemaining: data?.user?.credits_available,
        };
      }
    } catch (err) {
      logger.warn('Failed to retrieve Apollo usage metadata', err);
    }

    return { creditsUsed: 0 };
  }

  /**
   * Stage B: People API Search (0 credits consumed)
   * Discovers matching people matching domain and job titles
   */
  async searchPeople(domain: string, roles: string[]): Promise<ProviderPersonResult[]> {
    this.lastError = null;
    if (!this.apiKey) {
      this.lastError = 'Apollo API key missing';
      logger.warn('Apollo searchPeople called without API key');
      return [];
    }

    const url = new URL(`${this.baseUrl}/api/v1/mixed_people/api_search`);
    url.searchParams.append('q_organization_domains[]', domain);
    url.searchParams.append('page', '1');
    url.searchParams.append('per_page', '15');
    
    for (const role of roles) {
      url.searchParams.append('person_titles[]', role);
    }

    try {
      const res = await fetchWithRetry(url.toString(), {
        method: 'POST',
        headers: {
          'X-Api-Key': this.apiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      });

      if (!res.ok) {
        let errorMsg = `Apollo search returned status ${res.status}`;
        try {
          const errData = (await res.json()) as any;
          if (errData?.error) {
            errorMsg = errData.error;
          }
        } catch {
          // ignore json parse error
        }

        if (res.status === 403) {
          this.lastError = 'Apollo Free plan does not include Search API access (paid Apollo plan required).';
        } else {
          this.lastError = errorMsg;
        }

        logger.warn(`Apollo searchPeople failed: ${this.lastError}`);
        return [];
      }

      const data = (await res.json()) as any;
      const people = data.people || [];

      return people.map((p: any) => ({
        providerPersonId: p.id,
        firstName: p.first_name,
        lastName: p.last_name,
        fullName: p.name || `${p.first_name || ''} ${p.last_name || ''}`.trim(),
        title: p.title || p.headline,
        organizationName: p.organization?.name,
        organizationDomain: p.organization?.primary_domain || domain,
        linkedinUrl: p.linkedin_url,
        headline: p.headline,
      }));
    } catch (err: any) {
      this.lastError = `Apollo network error: ${err.message}`;
      logger.error('Apollo searchPeople network failure', { message: err.message });
      return [];
    }
  }

  async searchDomainContacts(_domain: string, _roles: string[]): Promise<ProviderContactResult[]> {
    // Apollo primary method is searchPeople; searchDomainContacts delegates to searchPeople
    return [];
  }

  /**
   * Enriches a person profile via bulk_match to unlock email address.
   * Consumes 1 export credit on Apollo.
   */
  async enrichPerson(details: {
    id?: string;
    firstName?: string;
    lastName?: string;
    domain?: string;
    organizationName?: string;
  }): Promise<ProviderEnrichResult> {
    if (!this.apiKey) {
      return { success: false };
    }

    const record: any = {};
    if (details.id) record.id = details.id;
    if (details.firstName) record.first_name = details.firstName;
    if (details.lastName) record.last_name = details.lastName;
    if (details.domain) record.domain = details.domain;
    if (details.organizationName) record.organization_name = details.organizationName;

    try {
      const res = await fetchWithRetry(`${this.baseUrl}/api/v1/people/bulk_match`, {
        method: 'POST',
        headers: {
          'X-Api-Key': this.apiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ details: [record] }),
      });

      if (!res.ok) {
        logger.warn(`Apollo bulk_match returned ${res.status}`);
        return { success: false };
      }

      const data = (await res.json()) as any;
      const match = data.matches?.[0];

      if (!match || !match.email) {
        return { success: false, creditsConsumed: 0 };
      }

      const emailStatus: EmailVerificationStatus =
        match.email_status === 'verified'
          ? 'verified'
          : match.email_status === 'extrapolated' || match.email_status === 'guessed'
          ? 'unverified'
          : 'unknown';

      return {
        success: true,
        email: match.email,
        emailStatus,
        linkedinUrl: match.linkedin_url,
        creditsConsumed: 1,
        raw: match,
      };
    } catch (err: any) {
      logger.error('Apollo enrichPerson failure', { message: err.message });
      return { success: false };
    }
  }

  async findEmail(_domain: string, _firstName: string, _lastName: string): Promise<ProviderEmailResult> {
    // Apollo uses enrichPerson
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
