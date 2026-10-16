import { IContactProvider } from '../base.provider.js';
import {
  ProviderName,
  ProviderHealthResult,
  ProviderUsageResult,
  ProviderPersonResult,
  ProviderContactResult,
  ProviderEnrichResult,
  ProviderEmailResult,
  ProviderVerificationResult,
} from '../../models/types.js';

export class MockProvider implements IContactProvider {
  readonly name: ProviderName = 'mock';

  getLastError(): string | null {
    return null;
  }

  clearLastError(): void {}

  async healthCheck(): Promise<ProviderHealthResult> {
    return {
      healthy: true,
      authenticated: true,
      canSearch: true,
      status: 'operational',
      provider: this.name,
      message: 'Mock Provider operational (Simulation / Demo / Test mode).',
      authMessage: 'Simulation Active',
      latencyMs: 12,
    };
  }

  async getUsage(): Promise<ProviderUsageResult> {
    return {
      planName: 'Mock Unlimited',
      creditsUsed: 10,
      creditsRemaining: 990,
      isUnlimited: true,
    };
  }

  async searchPeople(domain: string, roles: string[]): Promise<ProviderPersonResult[]> {
    const cleanDomain = domain.replace(/https?:\/\//, '').split('/')[0];
    const company = cleanDomain.split('.')[0];
    const capitalizedCompany = company.charAt(0).toUpperCase() + company.slice(1);

    const results: ProviderPersonResult[] = [];
    const samplePeople = [
      { first: 'Sarah', last: 'Chen', title: 'Senior Technical Recruiter' },
      { first: 'Alex', last: 'Mercer', title: 'Engineering Manager, Platform' },
      { first: 'Emily', last: 'Watson', title: 'Head of Talent Acquisition' },
      { first: 'David', last: 'Kim', title: 'Staff Software Engineer' },
    ];

    for (const p of samplePeople) {
      const isRoleMatch = roles.length === 0 || roles.some((r) => p.title.toLowerCase().includes(r.toLowerCase()));
      if (isRoleMatch) {
        results.push({
          providerPersonId: `mock-apollo-${p.first.toLowerCase()}-${company}`,
          firstName: p.first,
          lastName: p.last,
          fullName: `${p.first} ${p.last}`,
          title: p.title,
          organizationName: capitalizedCompany,
          organizationDomain: cleanDomain,
          linkedinUrl: `https://www.linkedin.com/in/${p.first.toLowerCase()}-${p.last.toLowerCase()}`,
        });
      }
    }

    return results;
  }

  async searchDomainContacts(domain: string, roles: string[]): Promise<ProviderContactResult[]> {
    const cleanDomain = domain.replace(/https?:\/\//, '').split('/')[0];
    const company = cleanDomain.split('.')[0];
    const capitalizedCompany = company.charAt(0).toUpperCase() + company.slice(1);

    const results: ProviderContactResult[] = [
      {
        email: `jessica.taylor@${cleanDomain}`,
        firstName: 'Jessica',
        lastName: 'Taylor',
        fullName: 'Jessica Taylor',
        position: 'University Talent Partner',
        companyName: capitalizedCompany,
        domain: cleanDomain,
        confidence: 96,
        status: 'verified',
        sources: [{ domain: cleanDomain, uri: `https://${cleanDomain}/about` }],
      },
      {
        email: `marcus.vance@${cleanDomain}`,
        firstName: 'Marcus',
        lastName: 'Vance',
        fullName: 'Marcus Vance',
        position: 'Director of Engineering',
        companyName: capitalizedCompany,
        domain: cleanDomain,
        confidence: 88,
        status: 'accept_all',
        sources: [{ domain: cleanDomain, uri: `https://${cleanDomain}/team` }],
      },
    ];

    if (roles.length > 0) {
      return results.filter((r) =>
        roles.some((role) => (r.position || '').toLowerCase().includes(role.toLowerCase()))
      );
    }

    return results;
  }

  async enrichPerson(details: {
    id?: string;
    firstName?: string;
    lastName?: string;
    domain?: string;
  }): Promise<ProviderEnrichResult> {
    const domain = details.domain || 'example.com';
    const first = (details.firstName || 'contact').toLowerCase();
    const last = (details.lastName || 'lead').toLowerCase();

    return {
      success: true,
      email: `${first}.${last}@${domain}`,
      emailStatus: 'verified',
      confidence: 95,
      linkedinUrl: `https://www.linkedin.com/in/${first}-${last}`,
      creditsConsumed: 1,
    };
  }

  async findEmail(domain: string, firstName: string, lastName: string): Promise<ProviderEmailResult> {
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${domain}`;
    return {
      found: true,
      email,
      score: 92,
      status: 'verified',
      creditsConsumed: 1,
      sources: [{ domain, uri: `https://${domain}/contacts` }],
    };
  }

  async verifyEmail(email: string): Promise<ProviderVerificationResult> {
    const isInvalid = email.includes('invalid') || email.includes('fake');
    const isCatchAll = email.includes('catchall');

    return {
      status: isInvalid ? 'invalid' : isCatchAll ? 'accept_all' : 'verified',
      score: isInvalid ? 10 : isCatchAll ? 65 : 98,
      smtpCheck: !isInvalid,
      mxCheck: true,
      isCatchAll,
      isDisposable: false,
    };
  }
}
