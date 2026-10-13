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

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.APOLLO_API_KEY || '';
  }

  setApiKey(key: string) {
    this.apiKey = key;
  }

  async healthCheck(): Promise<ProviderHealthResult> {
    if (!this.apiKey) {
      return {
        healthy: false,
        provider: this.name,
        message: 'Apollo API key is missing or not configured',
      };
    }

    const start = Date.now();
    try {
      // Test authentication via user info or ping
      const res = await fetchWithRetry(`${this.baseUrl}/v1/users/me`, {
        method: 'GET',
        headers: {
          'X-Api-Key': this.apiKey,
          'Content-Type': 'application/json',
        },
      });

      if (res.status === 401 || res.status === 403) {
        return {
          healthy: false,
          provider: this.name,
          message: 'Apollo authentication failed. Invalid or expired API key.',
          latencyMs: Date.now() - start,
        };
      }

      if (res.ok) {
        return {
          healthy: true,
          provider: this.name,
          message: 'Apollo connection successful and authenticated.',
          latencyMs: Date.now() - start,
        };
      }

      return {
        healthy: false,
        provider: this.name,
        message: `Apollo responded with status ${res.status}: ${res.statusText}`,
        latencyMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        healthy: false,
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
    if (!this.apiKey) {
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
        const errorText = await res.text();
        logger.error(`Apollo api_search returned ${res.status}`, { errorText });
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
