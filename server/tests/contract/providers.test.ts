import { describe, it, expect } from 'vitest';
import { MockProvider } from '../../src/providers/mock/mock.provider.js';
import { ApolloProvider } from '../../src/providers/apollo/apollo.provider.js';
import { HunterProvider } from '../../src/providers/hunter/hunter.provider.js';

describe('Provider Contract & Adapter Tests', () => {
  describe('MockProvider Contract (Deterministic Simulation)', () => {
    const provider = new MockProvider();

    it('returns healthy status on health check', async () => {
      const health = await provider.healthCheck();
      expect(health.healthy).toBe(true);
      expect(health.provider).toBe('mock');
    });

    it('returns people matching target domain and roles', async () => {
      const people = await provider.searchPeople('stripe.com', ['Recruiter']);
      expect(people.length).toBeGreaterThan(0);
      expect(people[0].organizationDomain).toBe('stripe.com');
      expect(people[0].title).toContain('Recruiter');
    });

    it('enriches person profiles with verified email format and credit consumption', async () => {
      const result = await provider.enrichPerson({
        firstName: 'Jane',
        lastName: 'Doe',
        domain: 'stripe.com',
      });
      expect(result.success).toBe(true);
      expect(result.email).toBe('jane.doe@stripe.com');
      expect(result.emailStatus).toBe('verified');
      expect(result.creditsConsumed).toBe(1);
    });

    it('verifies deliverability status honestly', async () => {
      const valid = await provider.verifyEmail('valid.person@stripe.com');
      expect(valid.status).toBe('verified');
      expect(valid.smtpCheck).toBe(true);

      const invalid = await provider.verifyEmail('fake-invalid@stripe.com');
      expect(invalid.status).toBe('invalid');
      expect(invalid.smtpCheck).toBe(false);
    });
  });

  describe('Apollo & Hunter Providers Unconfigured Behavior', () => {
    it('returns structured unhealthy response without crashing when API key is missing', async () => {
      const apollo = new ApolloProvider('');
      const health = await apollo.healthCheck();
      expect(health.healthy).toBe(false);
      expect(health.message).toContain('Apollo API key is missing');

      const hunter = new HunterProvider('');
      const hunterHealth = await hunter.healthCheck();
      expect(hunterHealth.healthy).toBe(false);
      expect(hunterHealth.message).toContain('Hunter API key is missing');
    });

    it('safely returns empty array on unauthenticated search without throwing', async () => {
      const apollo = new ApolloProvider('');
      const people = await apollo.searchPeople('example.com', ['Engineer']);
      expect(people).toEqual([]);

      const hunter = new HunterProvider('');
      const contacts = await hunter.searchDomainContacts('example.com', ['Engineer']);
      expect(contacts).toEqual([]);
    });
  });
});
