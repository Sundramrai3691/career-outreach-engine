import {
  ProviderName,
  ProviderHealthResult,
  ProviderUsageResult,
  ProviderPersonResult,
  ProviderContactResult,
  ProviderEnrichResult,
  ProviderEmailResult,
  ProviderVerificationResult,
} from '../models/types.js';

export interface IContactProvider {
  readonly name: ProviderName;

  /**
   * Performs connectivity and authentication validation
   */
  healthCheck(): Promise<ProviderHealthResult>;

  /**
   * Retrieves current credit and quota balance
   */
  getUsage(): Promise<ProviderUsageResult>;

  /**
   * Discovers people matching domain and target job titles
   */
  searchPeople(domain: string, roles: string[]): Promise<ProviderPersonResult[]>;

  /**
   * Searches public company domain contacts (e.g. Hunter domain search)
   */
  searchDomainContacts(domain: string, roles: string[]): Promise<ProviderContactResult[]>;

  /**
   * Enriches profile data to unlock direct professional email
   */
  enrichPerson(details: {
    id?: string;
    firstName?: string;
    lastName?: string;
    domain?: string;
    organizationName?: string;
  }): Promise<ProviderEnrichResult>;

  /**
   * Direct email resolution for known name and domain
   */
  findEmail(domain: string, firstName: string, lastName: string): Promise<ProviderEmailResult>;

  /**
   * Validates deliverability of an email address
   */
  verifyEmail(email: string): Promise<ProviderVerificationResult>;
}

/**
 * Executes a network call with exponential backoff and jitter for transient errors (5xx, 429)
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3,
  initialDelayMs = 1000
): Promise<Response> {
  let attempt = 0;
  let delay = initialDelayMs;

  while (true) {
    attempt++;
    try {
      const response = await fetch(url, options);

      // Handle 429 Rate Limit
      if (response.status === 429 && attempt <= maxRetries) {
        const retryAfterHeader = response.headers.get('retry-after');
        const retryDelay = retryAfterHeader
          ? parseInt(retryAfterHeader, 10) * 1000
          : delay + Math.random() * 500;
        await new Promise((r) => setTimeout(r, retryDelay));
        delay *= 2;
        continue;
      }

      // Handle transient 5xx server errors
      if (response.status >= 500 && attempt <= maxRetries) {
        const jitter = Math.random() * 500;
        await new Promise((r) => setTimeout(r, delay + jitter));
        delay *= 2;
        continue;
      }

      return response;
    } catch (err: any) {
      if (attempt >= maxRetries) {
        throw err;
      }
      const jitter = Math.random() * 500;
      await new Promise((r) => setTimeout(r, delay + jitter));
      delay *= 2;
    }
  }
}
