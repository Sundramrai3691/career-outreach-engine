import { TemplateVariables, RenderedEmail } from '../models/types.js';

export class NormalizerService {
  /**
   * Normalizes a company domain to its canonical form (e.g., "https://www.google.com/about" -> "google.com")
   */
  static normalizeDomain(input?: string | null): string | undefined {
    if (!input || !input.trim()) return undefined;
    let domain = input.trim().toLowerCase();

    // Remove protocol
    domain = domain.replace(/^https?:\/\//i, '');
    // Remove www prefix
    domain = domain.replace(/^www\./i, '');
    // Remove port, paths, query params, hashes
    domain = domain.split('/')[0].split('?')[0].split('#')[0].split(':')[0];

    // Basic domain validation pattern
    const domainRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
    if (!domainRegex.test(domain)) {
      return undefined;
    }

    return domain;
  }

  /**
   * Normalizes company name by stripping common corporate suffixes and symbols
   */
  static normalizeCompanyName(name: string): string {
    if (!name) return '';
    let clean = name.trim();

    // Remove common legal entity suffixes
    clean = clean.replace(/,\s*(inc\.?|llc\.?|ltd\.?|corp\.?|corporation|gmbh|co\.?|pvt\.?\s*ltd\.?)$/i, '');
    clean = clean.replace(/\s+(inc\.?|llc\.?|ltd\.?|corp\.?|corporation|gmbh|co\.?|pvt\.?\s*ltd\.?)$/i, '');

    return clean.trim();
  }

  /**
   * Normalizes email address
   */
  static normalizeEmail(email: string): string {
    if (!email) return '';
    return email.trim().toLowerCase();
  }

  /**
   * Checks if an email is syntactically valid according to RFC 5322 standard
   */
  static isValidEmailFormat(email: string): boolean {
    if (!email || email.length > 254) return false;
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
    return emailRegex.test(email);
  }

  /**
   * Checks if a contact's job title matches any of the target roles
   * Returns matching role title or null
   */
  static matchTargetRole(contactTitle: string | undefined, targetRoles: string[]): { isMatch: boolean; matchedRole?: string; score: number } {
    if (!contactTitle || !targetRoles || targetRoles.length === 0) {
      return { isMatch: false, score: 0 };
    }

    const titleLower = contactTitle.toLowerCase().trim();

    // 1. Exact match
    for (const role of targetRoles) {
      const roleLower = role.toLowerCase().trim();
      if (titleLower === roleLower) {
        return { isMatch: true, matchedRole: role, score: 100 };
      }
    }

    // 2. Substring / Word boundary match
    for (const role of targetRoles) {
      const roleLower = role.toLowerCase().trim();
      if (titleLower.includes(roleLower)) {
        return { isMatch: true, matchedRole: role, score: 85 };
      }

      // Check common synonym / equivalent roles
      if (this.areRolesEquivalent(titleLower, roleLower)) {
        return { isMatch: true, matchedRole: role, score: 75 };
      }
    }

    return { isMatch: false, score: 0 };
  }

  /**
   * Translates selected target roles to Tomba's documented department filters
   * ('hr', 'engineering', 'sales', 'marketing', 'legal', 'support').
   * If roles span multiple departments or cannot be unambiguously mapped, returns undefined.
   */
  static mapRolesToTombaDepartment(roles: string[]): string | undefined {
    if (!roles || roles.length === 0) return undefined;

    const hrKeywords = ['recruiter', 'talent', 'sourcer', 'recruiting', 'hr', 'human resources', 'people partner', 'talent acquisition'];
    const engineeringKeywords = [
      'software', 'engineer', 'engineering', 'developer', 'tech lead', 'architect',
      'frontend', 'backend', 'full stack', 'devops', 'sre', 'systems', 'infrastructure'
    ];
    const salesKeywords = ['sales', 'account executive', 'business development', 'sdr', 'bdr', 'ae'];
    const marketingKeywords = ['marketing', 'growth', 'seo', 'content', 'brand'];

    const roleMatchesCategory = (role: string, keywords: string[]) => {
      const r = role.toLowerCase();
      return keywords.some((kw) => r.includes(kw));
    };

    const isAllHr = roles.every((r) => roleMatchesCategory(r, hrKeywords));
    if (isAllHr) return 'hr';

    const isAllEng = roles.every((r) => roleMatchesCategory(r, engineeringKeywords));
    if (isAllEng) return 'engineering';

    const isAllSales = roles.every((r) => roleMatchesCategory(r, salesKeywords));
    if (isAllSales) return 'sales';

    const isAllMarketing = roles.every((r) => roleMatchesCategory(r, marketingKeywords));
    if (isAllMarketing) return 'marketing';

    return undefined;
  }

  /**
   * Maps user-entered location text to a 2-letter ISO 3166-1 alpha-2 country code
   * for Tomba country filtering.
   */
  static mapLocationToCountryCode(location?: string): string | undefined {
    if (!location || !location.trim()) return undefined;
    const loc = location.trim().toLowerCase();

    // United States / US states & major tech hubs
    if (
      loc.includes('united states') ||
      loc.includes('usa') ||
      loc.includes(' u.s.') ||
      loc.includes('san francisco') ||
      loc.includes('new york') ||
      loc.includes('seattle') ||
      loc.includes('austin') ||
      loc.includes('chicago') ||
      loc.includes('boston') ||
      loc.includes('los angeles') ||
      loc.includes('california') ||
      loc.includes('texas') ||
      /\b(ca|ny|tx|wa|il|ma|fl|co|nc|ga)\b/i.test(loc)
    ) {
      return 'US';
    }

    // United Kingdom
    if (loc.includes('united kingdom') || loc.includes('uk') || loc.includes('london') || loc.includes('england')) {
      return 'GB';
    }

    // Canada
    if (loc.includes('canada') || loc.includes('toronto') || loc.includes('vancouver') || loc.includes('montreal')) {
      return 'CA';
    }

    // Germany
    if (loc.includes('germany') || loc.includes('deutschland') || loc.includes('berlin') || loc.includes('munich')) {
      return 'DE';
    }

    // France
    if (loc.includes('france') || loc.includes('paris')) {
      return 'FR';
    }

    // India
    if (loc.includes('india') || loc.includes('bengaluru') || loc.includes('bangalore') || loc.includes('delhi') || loc.includes('mumbai') || loc.includes('hyderabad')) {
      return 'IN';
    }

    return undefined;
  }

  /**
   * Checks equivalent keywords for common recruitment, engineering, and tech management roles
   */
  private static areRolesEquivalent(titleLower: string, targetLower: string): boolean {
    const recruiterSynonyms = ['recruiter', 'talent', 'talent acquisition', 'sourcer', 'recruiting', 'people partner', 'hr'];
    const engineeringManagerSynonyms = ['engineering manager', 'tech lead', 'em', 'director of engineering', 'vp of engineering', 'head of engineering'];
    const softwareEngineerSynonyms = ['software engineer', 'software developer', 'backend engineer', 'frontend engineer', 'full stack engineer', 'staff engineer', 'principal engineer', 'systems engineer'];

    const isTargetRecruiter = recruiterSynonyms.some((s) => targetLower.includes(s));
    if (isTargetRecruiter) {
      if (recruiterSynonyms.some((s) => titleLower.includes(s))) {
        return true;
      }
    }

    const isTargetEM = engineeringManagerSynonyms.some((s) => targetLower.includes(s));
    if (isTargetEM) {
      if (engineeringManagerSynonyms.some((s) => titleLower.includes(s))) {
        return true;
      }
    }

    const isTargetSWE = softwareEngineerSynonyms.some((s) => targetLower.includes(s));
    if (isTargetSWE) {
      if (softwareEngineerSynonyms.some((s) => titleLower.includes(s))) {
        return true;
      }
    }

    return false;
  }

  /**
   * Renders email template variables into subject and body
   */
  static renderTemplate(
    subjectTemplate: string,
    bodyTemplate: string,
    variables: TemplateVariables
  ): RenderedEmail {
    let subject = subjectTemplate;
    let body = bodyTemplate;
    const missingVariables: string[] = [];

    // Find all {{VariableName}} placeholders
    const placeholderRegex = /\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g;

    const replaceTags = (text: string): string => {
      return text.replace(placeholderRegex, (match, varName) => {
        // Case-insensitive variable lookup
        const key = Object.keys(variables).find(
          (k) => k.toLowerCase() === varName.toLowerCase()
        );
        const val = key ? variables[key] : undefined;

        if (val === undefined || val === null || val.trim() === '') {
          if (!missingVariables.includes(varName)) {
            missingVariables.push(varName);
          }
          return match; // preserve variable for warning
        }
        return val;
      });
    };

    subject = replaceTags(subject);
    body = replaceTags(body);

    return {
      to: variables.Email || '',
      subject,
      body,
      missingVariables,
    };
  }
}
