import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TombaProvider } from '../../src/providers/tomba/tomba.provider.js';

describe('TombaProvider Unit Tests', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    TombaProvider.clearCache();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('Credential Validation and Missing State', () => {
    it('returns unconfigured status when API key or secret key are missing', async () => {
      const providerNoKey = new TombaProvider('', 'secret');
      const healthNoKey = await providerNoKey.healthCheck();
      expect(healthNoKey.healthy).toBe(false);
      expect(healthNoKey.authConfigured).toBe(false);
      expect(healthNoKey.canSearch).toBe(false);
      expect(healthNoKey.message).toContain('Missing Tomba API Key or Secret');

      const providerNoSecret = new TombaProvider('key', '');
      const healthNoSecret = await providerNoSecret.healthCheck();
      expect(healthNoSecret.healthy).toBe(false);
      expect(healthNoSecret.authConfigured).toBe(false);

      const contacts = await providerNoKey.searchDomainContacts('stripe.com', {});
      expect(contacts).toEqual([]);
    });
  });

  describe('Health Check (/v1/me)', () => {
    it('parses valid /v1/me response with plan quotas and rate limits', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        headers: {
          get: (header: string) => {
            const h = header.toLowerCase();
            if (h === 'x-ratelimit-limit') return '1';
            if (h === 'x-ratelimit-remaining') return '0';
            if (h === 'x-ratelimit-reset') return '1710000000';
            return null;
          },
        },
        json: async () => ({
          data: {
            first_name: 'John',
            last_name: 'Doe',
            email: 'john@example.com',
            pricing: {
              plan: {
                name: 'Free',
              },
              requests: {
                search: {
                  available: 24,
                  used: 1,
                  total: 25,
                },
                verification: {
                  available: 50,
                  used: 0,
                  total: 50,
                },
              },
            },
          },
        }),
      } as any);

      const provider = new TombaProvider('ta_test_key', 'ts_test_secret');
      const health = await provider.healthCheck();

      expect(health.healthy).toBe(true);
      expect(health.status).toBe('healthy');
      expect(health.authConfigured).toBe(true);
      expect(health.canSearch).toBe(true);
      expect(health.planName).toBe('Free');
      expect(health.availableSearches).toBe(24);
      expect(health.availableVerifications).toBe(50);
      expect(health.rateLimits?.limitRequests).toBe(1);

      // Verify request sent headers and not query params
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.tomba.io/v1/me',
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Tomba-Key': 'ta_test_key',
            'X-Tomba-Secret': 'ts_test_secret',
          }),
        })
      );
    });

    it('handles 401 unauthorized response gracefully', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 401,
        ok: false,
        headers: { get: () => null },
        json: async () => ({
          errors: [{ message: 'Unauthorized access' }],
        }),
      } as any);

      const provider = new TombaProvider('ta_bad_key', 'ts_bad_secret');
      const health = await provider.healthCheck();

      expect(health.healthy).toBe(false);
      expect(health.status).toBe('error');
      expect(health.authConfigured).toBe(false);
      expect(health.canSearch).toBe(false);
      expect(health.message).toContain('Unauthorized access');
    });

    it('handles 402 payment required as quota_exhausted', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 402,
        ok: false,
        headers: { get: () => null },
        json: async () => ({
          errors: [{ message: 'Your search quota is exhausted' }],
        }),
      } as any);

      const provider = new TombaProvider('ta_key', 'ts_secret');
      const health = await provider.healthCheck();

      expect(health.healthy).toBe(false);
      expect(health.status).toBe('quota_exhausted');
      expect(health.canSearch).toBe(false);
      expect(health.message).toContain('Your search quota is exhausted');
    });

    it('handles 429 rate limited with Retry-After header', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 429,
        ok: false,
        headers: {
          get: (h: string) => (h.toLowerCase() === 'retry-after' ? '30' : null),
        },
        json: async () => ({
          errors: [{ message: 'Rate limit exceeded. Please wait.' }],
        }),
      } as any);

      const provider = new TombaProvider('ta_key', 'ts_secret');
      const health = await provider.healthCheck();

      expect(health.healthy).toBe(false);
      expect(health.status).toBe('rate_limited');
      expect(health.canSearch).toBe(false);
      expect(health.message).toContain('Retry after 30s');
    });
  });

  describe('Domain Search (/v1/domain-search)', () => {
    it('enforces Free-tier cap of 10 results and page 1, passing headers and params correctly', async () => {
      let requestedUrl = '';
      let requestedHeaders: any = {};

      global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
        requestedUrl = url;
        requestedHeaders = options.headers;
        return {
          status: 200,
          ok: true,
          headers: { get: () => null },
          json: async () => ({
            data: {
              organization: {
                name: 'Stripe',
                website_url: 'https://stripe.com',
              },
              emails: [
                {
                  first_name: 'Alice',
                  last_name: 'Smith',
                  email: 'alice@stripe.com',
                  position: 'Technical Recruiter',
                  department: 'Human Resources',
                  seniority: 'senior',
                  score: 95,
                  verification: {
                    status: 'valid',
                  },
                  sources: [
                    { uri: 'https://stripe.com/jobs', extracted_on: '2026-01-15' },
                  ],
                },
              ],
            },
          }),
        };
      });

      const provider = new TombaProvider('ta_key', 'ts_secret');
      // Pass a requested limit of 50 to ensure provider caps to 10 for Free tier
      const contacts = await provider.searchDomainContacts('stripe.com', {
        limit: 50,
        department: 'hr',
        country: 'US',
      });

      expect(contacts).toHaveLength(1);
      const contact = contacts[0];
      expect(contact.email).toBe('alice@stripe.com');
      expect(contact.firstName).toBe('Alice');
      expect(contact.lastName).toBe('Smith');
      expect(contact.title).toBe('Technical Recruiter');
      expect(contact.confidence).toBe(95);
      expect(contact.metadata?.seniority).toBe('senior');
      expect(contact.metadata?.department).toBe('Human Resources');
      expect(contact.metadata?.provenanceSources).toHaveLength(1);

      // Verify URL constraints
      const urlObj = new URL(requestedUrl);
      expect(urlObj.searchParams.get('domain')).toBe('stripe.com');
      expect(urlObj.searchParams.get('limit')).toBe('10'); // Capped to 10
      expect(urlObj.searchParams.get('page')).toBe('1');
      expect(urlObj.searchParams.get('department')).toBe('hr');
      expect(urlObj.searchParams.get('country')).toBe('US');

      // Verify authentication via headers only
      expect(requestedHeaders['X-Tomba-Key']).toBe('ta_key');
      expect(requestedHeaders['X-Tomba-Secret']).toBe('ts_secret');
      expect(requestedUrl).not.toContain('key=');
      expect(requestedUrl).not.toContain('secret=');
    });

    it('in-memory caches duplicate requests to prevent consuming multiple credits', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        headers: { get: () => null },
        json: async () => ({
          data: {
            organization: { name: 'Acme' },
            emails: [
              {
                first_name: 'Bob',
                last_name: 'Jones',
                email: 'bob@acme.com',
                position: 'Recruiter',
                score: 80,
              },
            ],
          },
        }),
      });
      global.fetch = mockFetch;

      const provider = new TombaProvider('ta_key', 'ts_secret');

      // Call 1
      const res1 = await provider.searchDomainContacts('acme.com', { department: 'hr' });
      expect(res1).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Call 2 with identical domain & department
      const res2 = await provider.searchDomainContacts('acme.com', { department: 'hr' });
      expect(res2).toHaveLength(1);
      // Fetch should not have been called a second time
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('handles HTTP 200 with empty email array without errors', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        headers: { get: () => null },
        json: async () => ({
          data: {
            organization: { name: 'TinyStartup' },
            emails: [],
          },
        }),
      } as any);

      const provider = new TombaProvider('ta_key', 'ts_secret');
      const contacts = await provider.searchDomainContacts('tinystartup.io', {});
      expect(contacts).toEqual([]);
    });
  });

  describe('Email Verification (/v1/email-verifier)', () => {
    it('verifies email deliverability accurately', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        headers: { get: () => null },
        json: async () => ({
          data: {
            email: 'test@example.com',
            result: 'deliverable',
            score: 90,
            mx_records: true,
            smtp_check: true,
            disposable: false,
            webmail: false,
          },
        }),
      } as any);

      const provider = new TombaProvider('ta_key', 'ts_secret');
      const ver = await provider.verifyEmail('test@example.com');

      expect(ver.status).toBe('valid');
      expect(ver.score).toBe(90);
      expect(ver.isSmtpValid).toBe(true);
      expect(ver.isMxValid).toBe(true);
      expect(ver.isDisposable).toBe(false);
      expect(ver.provider).toBe('tomba');
    });
  });
});
