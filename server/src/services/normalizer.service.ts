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
   * Checks equivalent keywords for common recruitment and tech roles
   */
  private static areRolesEquivalent(titleLower: string, targetLower: string): boolean {
    const recruiterSynonyms = ['recruiter', 'talent', 'talent acquisition', 'sourcer', 'recruiting', 'people partner', 'hr'];
    const engineeringManagerSynonyms = ['engineering manager', 'tech lead', 'em', 'director of engineering', 'vp of engineering', 'head of engineering'];

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
