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

export interface TombaDomainSearchOptions {
  department?: string;
  country?: string;
  limit?: number;
  page?: number;
}

export class TombaProvider implements IContactProvider {
  readonly name: ProviderName = 'tomba';
  private apiKey: string;
  private secretKey: string;
  private baseUrl = 'https://api.tomba.io/v1';
  private lastError: string | null = null;

  // In-memory request cache to prevent duplicate credit consumption in the same session
  private static domainSearchCache = new Map<string, { data: ProviderContactResult[]; timestamp: number }>();
  private cacheTtlMs = 1000 * 60 * 30; // 30 minutes cache TTL

  static clearCache(): void {
    TombaProvider.domainSearchCache.clear();
  }

  clearCache(): void {
    TombaProvider.domainSearchCache.clear();
  }

  constructor(apiKey?: string, secretKey?: string) {
    this.apiKey = apiKey || process.env.TOMBA_API_KEY || '';

    // Handle TOMBA_SECRET_KEY with TOMBA_API_SECRET backward compatibility alias
    const secretKeyEnv = process.env.TOMBA_SECRET_KEY?.trim() || '';
    const apiSecretEnv = process.env.TOMBA_API_SECRET?.trim() || '';

    if (secretKeyEnv && apiSecretEnv && secretKeyEnv !== apiSecretEnv) {
      throw new Error(
        'Configuration error: Conflicting values for TOMBA_SECRET_KEY and alias TOMBA_API_SECRET. Please ensure both variables match or define only TOMBA_SECRET_KEY.'
      );
    }

    this.secretKey = secretKey || secretKeyEnv || apiSecretEnv;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  clearLastError(): void {
    this.lastError = null;
  }

  setCredentials(apiKey: string, secretKey: string): void {
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.lastError = null;
  }

  private getAuthHeaders(): Record<string, string> {
    return {
      'X-Tomba-Key': this.apiKey,
      'X-Tomba-Secret': this.secretKey,
      'Accept': 'application/json',
    };
  }

  /**
   * Safe account health and quota inspection using official GET /v1/me.
   * Never exposes raw API key or secret to the UI.
   */
  async healthCheck(): Promise<ProviderHealthResult> {
    if (!this.apiKey || !this.secretKey) {
      return {
        healthy: false,
        authenticated: false,
        authConfigured: false,
        canSearch: false,
        status: 'missing_credentials',
        provider: this.name,
        message: 'Missing Tomba API Key or Secret. Configure TOMBA_API_KEY and TOMBA_SECRET_KEY in Settings or .env.',
        nextAction: 'Add TOMBA_API_KEY and TOMBA_SECRET_KEY to your .env file or Settings page.',
      };
    }

    const start = Date.now();
    try {
      const res = await fetchWithRetry(
        `${this.baseUrl}/me`,
        {
          method: 'GET',
          headers: this.getAuthHeaders(),
        },
        0
      );

      const latencyMs = Date.now() - start;

      // Parse Rate Limit headers where available
      const rps = res.headers.get('x-second-rate-limit') ? parseInt(res.headers.get('x-second-rate-limit')!, 10) : undefined;
      const rpm = res.headers.get('x-minute-rate-limit') ? parseInt(res.headers.get('x-minute-rate-limit')!, 10) : undefined;
      const daily = res.headers.get('x-daily-rate-limit') ? parseInt(res.headers.get('x-daily-rate-limit')!, 10) : undefined;
      const dailyLeft = res.headers.get('x-daily-request-left') ? parseInt(res.headers.get('x-daily-request-left')!, 10) : undefined;
      const limitRequests = res.headers.get('x-ratelimit-limit') ? parseInt(res.headers.get('x-ratelimit-limit')!, 10) : undefined;
      const remainingRequests = res.headers.get('x-ratelimit-remaining') ? parseInt(res.headers.get('x-ratelimit-remaining')!, 10) : undefined;
      const resetTime = res.headers.get('x-ratelimit-reset') ? parseInt(res.headers.get('x-ratelimit-reset')!, 10) : undefined;

      const rateLimits = {
        rps,
        rpm,
        daily,
        dailyLeft,
        limitRequests,
        remainingRequests,
        resetTime,
      };

      if (res.status === 401) {
        return {
          healthy: false,
          authenticated: false,
          authConfigured: false,
          canSearch: false,
          status: 'error',
          provider: this.name,
          message: 'Tomba authentication failed: Invalid API key or account secret (HTTP 401). Unauthorized access.',
          authMessage: 'Invalid Credentials',
          nextAction: 'Verify your TOMBA_API_KEY and TOMBA_SECRET_KEY in Settings or .env.',
          latencyMs,
        };
      }

      if (res.status === 400) {
        const errJson = (await res.json().catch(() => ({}))) as any;
        const errType = errJson?.errors?.type;
        const errMsg = errJson?.errors?.message || 'Bad Request (HTTP 400)';
        return {
          healthy: false,
          authenticated: false,
          authConfigured: false,
          canSearch: false,
          status: 'error',
          provider: this.name,
          message: `Tomba request rejected: ${errMsg} (${errType || '400'})`,
          nextAction: errType === 'api_key_expired' ? 'Generate a new active key in Tomba dashboard.' : 'Verify request parameters.',
          latencyMs,
        };
      }

      if (res.status === 402) {
        const errJson = (await res.json().catch(() => ({}))) as any;
        const errMsg = errJson?.errors?.[0]?.message || errJson?.errors?.message || 'Your search quota is exhausted';
        return {
          healthy: false,
          authenticated: true,
          authConfigured: true,
          canSearch: false,
          status: 'quota_exhausted',
          provider: this.name,
          message: `Tomba search quota exhausted: ${errMsg}`,
          authMessage: 'Authenticated (Quota Exhausted)',
          nextAction: 'Upgrade your Tomba plan or purchase a credit pack on tomba.io.',
          latencyMs,
          rateLimits,
        };
      }

      if (res.status === 429) {
        const retryAfter = res.headers.get('retry-after');
        return {
          healthy: false,
          authenticated: true,
          authConfigured: true,
          canSearch: false,
          status: 'rate_limited',
          provider: this.name,
          message: `Tomba rate limit reached (HTTP 429).${retryAfter ? ` Retry after ${retryAfter}s.` : ''}`,
          nextAction: 'Wait for the current rate limit window to reset before sending further requests.',
          latencyMs,
          rateLimits,
        };
      }

      if (!res.ok) {
        const errJson = (await res.json().catch(() => ({}))) as any;
        const msg = errJson?.errors?.message || `HTTP ${res.status}: ${res.statusText}`;
        return {
          healthy: false,
          authenticated: false,
          canSearch: false,
          status: 'error',
          provider: this.name,
          message: `Tomba health check failed: ${msg}`,
          latencyMs,
        };
      }

      const body = (await res.json()) as any;
      const data = body?.data;
      const pricing = data?.pricing;
      const plan = pricing?.plan?.name || pricing?.plan || 'Free';

      // Parse remaining credits from pricing structure
      let availableSearches = 0;
      if (typeof pricing?.available_searches === 'number') {
        availableSearches = pricing.available_searches;
      } else if (pricing?.requests?.search?.available !== undefined) {
        availableSearches = Number(pricing.requests.search.available || 0);
      } else if (pricing?.requests?.domains) {
        const allowed = Number(pricing.requests.domains.allowed || 0);
        const used = Number(pricing.requests.domains.used || 0);
        availableSearches = Math.max(0, allowed - used);
      }

      let availableVerifications = 0;
      if (typeof pricing?.available_verifications === 'number') {
        availableVerifications = pricing.available_verifications;
      } else if (pricing?.requests?.verification?.available !== undefined) {
        availableVerifications = Number(pricing.requests.verification.available || 0);
      } else if (pricing?.requests?.verifications) {
        const allowed = Number(pricing.requests.verifications.allowed || 0);
        const used = Number(pricing.requests.verifications.used || 0);
        availableVerifications = Math.max(0, allowed - used);
      }

      const canSearch = availableSearches > 0;

      return {
        healthy: canSearch,
        authenticated: true,
        authConfigured: true,
        canSearch,
        status: canSearch ? 'healthy' : 'quota_exhausted',
        provider: this.name,
        message: canSearch
          ? `Tomba connected (${plan} plan). ${availableSearches} search credits available.`
          : `Tomba connected (${plan} plan), but 0 search credits remain.`,
        authMessage: 'API Key & Secret Authenticated',
        planName: plan,
        availableSearches,
        availableVerifications,
        latencyMs,
        rateLimits,
        nextAction: canSearch ? undefined : 'Refill credits on tomba.io or use CSV import.',
      };
    } catch (err: any) {
      return {
        healthy: false,
        authenticated: false,
        authConfigured: false,
        canSearch: false,
        status: 'error',
        provider: this.name,
        message: `Tomba connection failed: ${err.message}`,
        nextAction: 'Check network connectivity or firewall rules.',
        latencyMs: Date.now() - start,
      };
    }
  }

  /**
   * Retrieves usage summary
   */
  async getUsage(): Promise<ProviderUsageResult> {
    const health = await this.healthCheck();
    return {
      planName: health.planName || 'Free',
      creditsRemaining: health.availableSearches,
      creditsUsed: 0,
      isUnlimited: false,
    };
  }

  /**
   * Official Tomba Domain Search implementation (GET /v1/domain-search).
   * Free-plan compliant (max 10 results, page 1, strictly no fabricated data).
   */
  async searchDomainContacts(
    domain: string,
    rolesOrOptions?: string[] | TombaDomainSearchOptions,
    maybeOptions?: TombaDomainSearchOptions
  ): Promise<ProviderContactResult[]> {
    this.lastError = null;

    let roles: string[] = [];
    let options: TombaDomainSearchOptions | undefined;

    if (Array.isArray(rolesOrOptions)) {
      roles = rolesOrOptions;
      options = maybeOptions;
    } else if (rolesOrOptions && typeof rolesOrOptions === 'object') {
      options = rolesOrOptions;
    }

    if (!this.apiKey || !this.secretKey) {
      this.lastError = 'Tomba API credentials missing (TOMBA_API_KEY / TOMBA_SECRET_KEY).';
      return [];
    }

    const cleanDomain = domain.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
    if (!cleanDomain) {
      return [];
    }

    // Free plan safety limits: limit capped at 10, page 1
    const limit = Math.min(options?.limit || 10, 10);
    const page = 1;
    const department = options?.department?.trim().toLowerCase();
    const country = options?.country?.trim().toUpperCase();

    // Check in-memory session cache to avoid redundant credit consumption
    const cacheKey = `${cleanDomain}:${department || ''}:${country || ''}:${limit}`;
    const cached = TombaProvider.domainSearchCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      logger.info(`[Tomba] Returning cached domain search for ${cleanDomain} (${cached.data.length} contacts)`);
      return cached.data;
    }

    // Construct query parameters
    const params = new URLSearchParams({
      domain: cleanDomain,
      limit: String(limit),
      page: String(page),
      type: 'all',
    });

    if (department) {
      params.set('department', department);
    }

    if (country && country.length === 2) {
      params.set('country', country);
    }

    try {
      const url = `${this.baseUrl}/domain-search?${params.toString()}`;
      const res = await fetchWithRetry(url, {
        method: 'GET',
        headers: this.getAuthHeaders(),
      });

      if (res.status === 400) {
        const err = (await res.json().catch(() => ({}))) as any;
        this.lastError = `Tomba parameter or key error: ${err?.errors?.message || 'Bad Request (400)'}`;
        return [];
      }

      if (res.status === 401) {
        this.lastError = 'Tomba authentication failed (HTTP 401): Invalid API key or account secret.';
        return [];
      }

      if (res.status === 402) {
        this.lastError = 'Tomba quota exceeded (HTTP 402): Not enough search credits.';
        return [];
      }

      if (res.status === 429) {
        const retryAfter = res.headers.get('retry-after');
        this.lastError = `Tomba rate limit exceeded (HTTP 429).${retryAfter ? ` Retry after ${retryAfter}s.` : ''}`;
        return [];
      }

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as any;
        this.lastError = `Tomba domain-search failed: ${err?.errors?.message || res.statusText}`;
        return [];
      }

      const body = (await res.json()) as any;
      const emailsArray = body?.data?.emails;

      // Handle legitimate empty email array with HTTP 200 as clean no-results outcome
      if (!Array.isArray(emailsArray) || emailsArray.length === 0) {
        TombaProvider.domainSearchCache.set(cacheKey, { data: [], timestamp: Date.now() });
        return [];
      }

      const results: ProviderContactResult[] = [];

      for (const item of emailsArray) {
        if (!item.email) continue;

        const email = String(item.email).trim().toLowerCase();
        const firstName = item.first_name ? String(item.first_name).trim() : undefined;
        const lastName = item.last_name ? String(item.last_name).trim() : undefined;
        const fullName =
          item.full_name ||
          (firstName && lastName ? `${firstName} ${lastName}` : firstName || lastName || email.split('@')[0]);

        const position = item.position ? String(item.position).trim() : 'Professional';
        const departmentReturned = item.department ? String(item.department).trim() : undefined;
        const seniority = item.seniority ? String(item.seniority).trim() : undefined;
        const linkedinUrl = item.linkedin ? String(item.linkedin).trim() : undefined;
        const score = typeof item.score === 'number' ? item.score : 80;

        // Map Tomba verification status safely
        let verificationStatus: EmailVerificationStatus = 'unverified';
        const rawStatus = item.verification?.status?.toLowerCase();
        if (rawStatus === 'valid') verificationStatus = 'verified';
        else if (rawStatus === 'accept_all') verificationStatus = 'accept_all';
        else if (rawStatus === 'invalid') verificationStatus = 'invalid';
        else verificationStatus = 'unverified';

        // Extract sources provenance
        const sources: Array<{ domain: string; uri: string; extractedOn?: string }> = [];
        if (Array.isArray(item.sources)) {
          for (const s of item.sources) {
            if (s.uri) {
              sources.push({
                domain: cleanDomain,
                uri: s.uri,
                extractedOn: s.extracted_on,
              });
            }
          }
        }

        results.push({
          email,
          firstName,
          lastName,
          fullName,
          position,
          title: position,
          companyName: body?.data?.organization?.name || cleanDomain,
          domain: cleanDomain,
          confidence: score,
          status: verificationStatus,
          sources: sources.length > 0 ? sources : undefined,
          metadata: {
            seniority,
            department: departmentReturned,
            provenanceSources: sources,
          },
          raw: {
            department: departmentReturned,
            seniority,
            linkedin: linkedinUrl,
            phoneNumber: item.phone_number,
            pattern: body?.data?.pattern,
          },
        } as any);
      }

      // Cache successful response
      TombaProvider.domainSearchCache.set(cacheKey, { data: results, timestamp: Date.now() });

      return results;
    } catch (err: any) {
      this.lastError = `Tomba domain-search network exception: ${err.message}`;
      return [];
    }
  }

  /**
   * Discovers people matching company domain and target roles
   */
  async searchPeople(domain: string, roles: string[]): Promise<ProviderPersonResult[]> {
    const contacts = await this.searchDomainContacts(domain, roles);
    return contacts.map((c) => ({
      providerPersonId: `tomba-${c.email}`,
      firstName: c.firstName,
      lastName: c.lastName,
      fullName: c.fullName || `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.email.split('@')[0],
      title: c.position,
      organizationName: c.companyName,
      organizationDomain: c.domain,
      linkedinUrl: c.raw?.linkedin,
    }));
  }

  /**
   * Enriches person details (uses returned domain contact data)
   */
  async enrichPerson(details: {
    id?: string;
    firstName?: string;
    lastName?: string;
    domain?: string;
    organizationName?: string;
  }): Promise<ProviderEnrichResult> {
    if (details.domain && details.firstName && details.lastName) {
      const emailRes = await this.findEmail(details.domain, details.firstName, details.lastName);
      if (emailRes.found && emailRes.email) {
        return {
          success: true,
          email: emailRes.email,
          emailStatus: emailRes.status,
          confidence: emailRes.score,
          creditsConsumed: 1,
        };
      }
    }

    return { success: false };
  }

  /**
   * Direct email resolution via GET /v1/email-finder
   */
  async findEmail(domain: string, firstName: string, lastName: string): Promise<ProviderEmailResult> {
    this.lastError = null;

    if (!this.apiKey || !this.secretKey) {
      return { found: false, status: 'unavailable' };
    }

    const cleanDomain = domain.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
    try {
      const params = new URLSearchParams({
        domain: cleanDomain,
        first_name: firstName,
        last_name: lastName,
      });

      const res = await fetchWithRetry(`${this.baseUrl}/email-finder?${params.toString()}`, {
        method: 'GET',
        headers: this.getAuthHeaders(),
      });

      if (!res.ok) {
        return { found: false, status: 'unknown' };
      }

      const body = (await res.json()) as any;
      const email = body?.data?.email;
      if (email) {
        const rawStatus = body?.data?.verification?.status?.toLowerCase();
        let status: EmailVerificationStatus = 'unverified';
        if (rawStatus === 'valid') status = 'verified';
        else if (rawStatus === 'accept_all') status = 'accept_all';
        else if (rawStatus === 'invalid') status = 'invalid';

        return {
          found: true,
          email,
          score: body?.data?.score || 85,
          status,
          creditsConsumed: 1,
        };
      }

      return { found: false, status: 'unknown' };
    } catch {
      return { found: false, status: 'unavailable' };
    }
  }

  /**
   * Validates deliverability of an email address via GET /v1/email-verifier
   */
  async verifyEmail(email: string): Promise<ProviderVerificationResult> {
    this.lastError = null;

    if (!this.apiKey || !this.secretKey) {
      return {
        status: 'unavailable',
        score: 0,
        smtpCheck: false,
        mxCheck: false,
        isCatchAll: false,
        isDisposable: false,
      };
    }

    try {
      const params = new URLSearchParams({ email });
      const res = await fetchWithRetry(`${this.baseUrl}/email-verifier?${params.toString()}`, {
        method: 'GET',
        headers: this.getAuthHeaders(),
      });

      if (!res.ok) {
        return {
          status: 'unknown',
          score: 50,
          smtpCheck: false,
          mxCheck: false,
          isCatchAll: false,
          isDisposable: false,
        };
      }

      const body = (await res.json()) as any;
      const data = body?.data;
      const rawStatus = (data?.result || data?.status)?.toLowerCase();
      let status: EmailVerificationStatus = 'unverified';

      if (rawStatus === 'valid' || rawStatus === 'deliverable') status = 'valid';
      else if (rawStatus === 'accept_all' || rawStatus === 'risky') status = 'accept_all';
      else if (rawStatus === 'invalid' || rawStatus === 'undeliverable') status = 'invalid';
      else if (rawStatus === 'disposable') status = 'invalid';

      const smtpCheck = Boolean(data?.checks?.smtp_check ?? data?.smtp_check);
      const mxCheck = Boolean(data?.checks?.mx_records ?? data?.mx_records);
      const isCatchAll = Boolean(data?.checks?.accept_all ?? data?.webmail);
      const isDisposable = Boolean(data?.checks?.disposable ?? data?.disposable);

      return {
        status,
        score: data?.score || 80,
        smtpCheck,
        mxCheck,
        isCatchAll,
        isDisposable,
        isSmtpValid: smtpCheck,
        isMxValid: mxCheck,
        provider: 'tomba',
        raw: data,
      } as any;
    } catch {
      return {
        status: 'unavailable',
        score: 0,
        smtpCheck: false,
        mxCheck: false,
        isCatchAll: false,
        isDisposable: false,
      };
    }
  }
}
