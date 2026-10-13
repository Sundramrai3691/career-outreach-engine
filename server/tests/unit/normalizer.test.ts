import { describe, it, expect } from 'vitest';
import { NormalizerService } from '../../src/services/normalizer.service.js';

describe('NormalizerService Unit Tests', () => {
  describe('Domain Normalization', () => {
    it('normalizes various domain URL formats to canonical domains', () => {
      expect(NormalizerService.normalizeDomain('https://www.stripe.com/about')).toBe('stripe.com');
      expect(NormalizerService.normalizeDomain('http://google.com/careers?q=tech')).toBe('google.com');
      expect(NormalizerService.normalizeDomain('subdomain.company.co.uk/')).toBe('subdomain.company.co.uk');
      expect(NormalizerService.normalizeDomain('WWW.MICROSOFT.COM')).toBe('microsoft.com');
    });

    it('returns undefined for invalid or empty domains', () => {
      expect(NormalizerService.normalizeDomain('')).toBeUndefined();
      expect(NormalizerService.normalizeDomain('not a valid domain')).toBeUndefined();
      expect(NormalizerService.normalizeDomain(null)).toBeUndefined();
    });
  });

  describe('Company Name Normalization', () => {
    it('strips common corporate suffixes and symbols', () => {
      expect(NormalizerService.normalizeCompanyName('Stripe, Inc.')).toBe('Stripe');
      expect(NormalizerService.normalizeCompanyName('OpenAI LLC')).toBe('OpenAI');
      expect(NormalizerService.normalizeCompanyName('Acme Corp.')).toBe('Acme');
      expect(NormalizerService.normalizeCompanyName('Tech Solutions Ltd')).toBe('Tech Solutions');
    });
  });

  describe('Target Role Matching', () => {
    it('accurately matches exact and equivalent recruiting roles', () => {
      const targetRoles = ['Technical Recruiter', 'Hiring Manager'];

      const match1 = NormalizerService.matchTargetRole('Technical Recruiter', targetRoles);
      expect(match1.isMatch).toBe(true);
      expect(match1.score).toBe(100);

      const match2 = NormalizerService.matchTargetRole('Lead Technical Recruiter, EMEA', targetRoles);
      expect(match2.isMatch).toBe(true);
      expect(match2.score).toBeGreaterThanOrEqual(85);

      const match3 = NormalizerService.matchTargetRole('Senior Talent Acquisition Specialist', targetRoles);
      expect(match3.isMatch).toBe(true);
      expect(match3.score).toBe(75); // synonym match
    });

    it('rejects unrelated roles', () => {
      const targetRoles = ['Recruiter'];
      const match = NormalizerService.matchTargetRole('Junior Accountant', targetRoles);
      expect(match.isMatch).toBe(false);
      expect(match.score).toBe(0);
    });
  });

  describe('Template Rendering and Variable Extraction', () => {
    it('renders template variables and flags missing variables', () => {
      const subject = 'Inquiry about {{Role}} roles at {{Company}}';
      const body = 'Hi {{FirstName}},\n\nI saw your work at {{Company}} and wanted to inquire about {{Role}}.\n\nBest, {{MissingVar}}';

      const variables = {
        FirstName: 'Sarah',
        Company: 'Vercel',
        Role: 'Software Engineer',
      };

      const result = NormalizerService.renderTemplate(subject, body, variables);

      expect(result.subject).toBe('Inquiry about Software Engineer roles at Vercel');
      expect(result.body).toContain('Hi Sarah,');
      expect(result.body).toContain('at Vercel');
      expect(result.missingVariables).toContain('MissingVar');
    });
  });
});
