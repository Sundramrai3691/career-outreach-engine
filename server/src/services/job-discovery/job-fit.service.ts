import { NormalizerService } from '../normalizer.service.js';

export type RemotePreference = 'any' | 'remote_preferred' | 'remote_only';

export interface CandidateProfileInput {
  targetRoles: string[];
  excludedRoles: string[];
  technicalSkills: string[];
  requiredSkills: string[];
  graduationYear?: number | null;
  eligibleGraduationYearMin?: number | null;
  eligibleGraduationYearMax?: number | null;
  experienceLevels: string[];
  locations: string[];
  remotePreference: RemotePreference;
  excludedLocations: string[];
}

export interface JobFitResult {
  included: boolean;
  score: number;
  matchedRole?: string;
  matchedLocation?: string;
  matches: string[];
  missing: string[];
  exclusions: string[];
}

export const EMPTY_CANDIDATE_PROFILE: CandidateProfileInput = {
  targetRoles: [], excludedRoles: [], technicalSkills: [], requiredSkills: [],
  experienceLevels: [], locations: [], remotePreference: 'any', excludedLocations: [],
};

function textContent(posting: { title: string; description?: string; location?: string }): string {
  return `${posting.title} ${posting.location || ''} ${posting.description || ''}`
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function includesPhrase(haystack: string, phrase: string): boolean {
  const normalized = phrase.toLowerCase().trim();
  return normalized.length > 0 && haystack.includes(normalized);
}

function inferExperienceLevel(text: string): string[] {
  const levels: string[] = [];
  if (/\bintern(ship)?\b/.test(text)) levels.push('internship');
  if (/\b(new grad|new graduate|university graduate|recent graduate|early career|entry.level)\b/.test(text)) levels.push('new_grad');
  if (/\b(junior|associate|entry.level|0\s*(?:-|to)\s*2 years?|1\s*(?:-|to)\s*2 years?)\b/.test(text)) levels.push('junior');
  if (/\b(mid.level|intermediate|3\s*(?:-|to)\s*5 years?)\b/.test(text)) levels.push('mid');
  if (/\b(senior|staff|principal|lead|7\+? years?|8\+? years?)\b/.test(text)) levels.push('senior');
  return levels;
}

function postingGraduationYears(text: string): number[] {
  const years = new Set<number>();
  for (const match of text.matchAll(/\b(?:class of|graduat(?:e|ing|ion) (?:in|year)|expected to graduate (?:in|by))\s*(20\d{2})\b/gi)) {
    years.add(Number(match[1]));
  }
  for (const match of text.matchAll(/\b(20\d{2})\s*(?:-|to|through)\s*(20\d{2})\s+(?:graduates?|graduating|graduation)\b/gi)) {
    years.add(Number(match[1]));
    years.add(Number(match[2]));
  }
  return Array.from(years);
}

function normalizedLocation(value: string): string {
  return value.normalize('NFKC').toLowerCase()
    .replace(/\bunited states(?: of america)?\b|\busa\b/g, 'us')
    .replace(/\bunited kingdom\b|\bgreat britain\b|\buk\b/g, 'uk')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

export function scoreJobFit(
  posting: { title: string; description?: string; location?: string },
  profile: CandidateProfileInput,
  fallbackRoles: string[] = []
): JobFitResult {
  const body = textContent(posting);
  const matches: string[] = [];
  const missing: string[] = [];
  const exclusions: string[] = [];
  let score = 0;

  const targetRoles = profile.targetRoles.length ? profile.targetRoles : fallbackRoles;
  const roleMatch = targetRoles
    .map((role) => ({ role, result: NormalizerService.matchTargetRole(posting.title, [role]) }))
    .find(({ result }) => result.isMatch);
  if (roleMatch) {
    matches.push(`Role matches “${roleMatch.role}”`);
    score += 35;
  } else if (targetRoles.length) {
    exclusions.push(`Title does not match any target role (${targetRoles.join(', ')})`);
  } else {
    missing.push('No target role configured');
  }

  const excludedRole = profile.excludedRoles.find((role) =>
    NormalizerService.matchTargetRole(posting.title, [role]).isMatch || includesPhrase(posting.title.toLowerCase(), role)
  );
  if (excludedRole) exclusions.push(`Role is excluded: ${excludedRole}`);

  const matchedSkills = profile.technicalSkills.filter((skill) => includesPhrase(body, skill));
  const missingSkills = profile.technicalSkills.filter((skill) => !matchedSkills.includes(skill));
  if (matchedSkills.length) {
    matches.push(`Skills found: ${matchedSkills.join(', ')}`);
    score += Math.round(25 * matchedSkills.length / Math.max(1, profile.technicalSkills.length));
  }
  if (missingSkills.length) missing.push(`Skills not mentioned: ${missingSkills.join(', ')}`);

  const missingRequired = profile.requiredSkills.filter((skill) => !includesPhrase(body, skill));
  if (missingRequired.length) exclusions.push(`Required skills not evidenced: ${missingRequired.join(', ')}`);
  else if (profile.requiredSkills.length) {
    matches.push(`All required skills found: ${profile.requiredSkills.join(', ')}`);
    score += 15;
  }

  const graduationYear = profile.graduationYear;
  const minYear = profile.eligibleGraduationYearMin ?? graduationYear;
  const maxYear = profile.eligibleGraduationYearMax ?? graduationYear;
  if (minYear && maxYear && minYear > maxYear) {
    exclusions.push('Configured eligible graduation year range is invalid');
  } else if (graduationYear || minYear || maxYear) {
    if (graduationYear && ((minYear != null && graduationYear < minYear) || (maxYear != null && graduationYear > maxYear))) {
      exclusions.push(`Graduation year ${graduationYear} is outside configured eligible range`);
    }
    const requestedYears = postingGraduationYears(body);
    if (requestedYears.length) {
      const low = Math.min(...requestedYears);
      const high = Math.max(...requestedYears);
      const overlapsRange = (minYear == null || high >= minYear) && (maxYear == null || low <= maxYear);
      const candidateFits = graduationYear == null || (graduationYear >= low && graduationYear <= high);
      if (!overlapsRange || !candidateFits) exclusions.push(`Posting specifies graduation year(s) ${low}–${high}`);
      else {
        matches.push(graduationYear
          ? `Graduation year ${graduationYear} matches posting eligibility`
          : `Posting graduation years ${low}–${high} overlap the configured eligible range`);
        score += 10;
      }
    } else {
      missing.push(graduationYear
        ? 'Posting does not state graduation-year eligibility'
        : 'Posting does not state graduation-year eligibility for the configured range');
    }
  }

  const observedLevels = inferExperienceLevel(body);
  if (profile.experienceLevels.length) {
    const compatible = profile.experienceLevels.filter((level) => observedLevels.includes(level));
    const explicitSenior = observedLevels.includes('senior') && profile.experienceLevels.some((level) => ['internship', 'new_grad', 'junior'].includes(level));
    if (explicitSenior) exclusions.push('Posting explicitly requires senior-level experience');
    else if (compatible.length) {
      matches.push(`Experience level matches: ${compatible.join(', ')}`);
      score += 10;
    } else {
      missing.push('Posting does not state a configured experience level');
    }
  }

  const location = (posting.location || '').trim();
  const locationKey = normalizedLocation(location);
  const excludedLocation = profile.excludedLocations.find((item) => locationKey.includes(normalizedLocation(item)));
  if (excludedLocation) exclusions.push(`Location is excluded: ${excludedLocation}`);
  let matchedLocation: string | undefined;
  if (profile.locations.length) {
    matchedLocation = profile.locations.find((item) => {
      const key = normalizedLocation(item);
      if (/\bremote\b/.test(key) && /\bremote\b/.test(locationKey)) {
        const requestedScope = key.replace(/\bremote\b/, '').trim();
        const postingScope = locationKey.replace(/\bremote\b/, '').trim();
        if (!requestedScope || /\b(global|worldwide|anywhere)\b/.test(requestedScope)) return true;
        return Boolean(postingScope && (postingScope.includes(requestedScope) || requestedScope.includes(postingScope)));
      }
      return locationKey.includes(key) || key.includes(locationKey);
    });
    if (matchedLocation) {
      matches.push(`Location matches “${matchedLocation}”`);
      score += 15;
    } else if (location) exclusions.push(`Location does not match configured locations (${profile.locations.join(', ')})`);
    else exclusions.push('Posting has no location evidence for configured location requirements');
  }
  if (profile.remotePreference === 'remote_only' && !/remote/i.test(location)) exclusions.push('Remote-only preference excludes this posting');
  if (profile.remotePreference === 'remote_preferred') {
    if (/remote/i.test(location)) { matches.push('Remote preference matches'); score += 5; }
    else missing.push('Posting is not marked remote');
  }

  if (matches.length > 0 && matches.every((detail) => detail.startsWith('Role matches'))) {
    missing.push('Title match alone is insufficient to confirm eligibility; add skills, graduation, experience, or location criteria.');
  }

  return {
    included: exclusions.length === 0,
    score: Math.max(0, Math.min(100, score)),
    matchedRole: roleMatch?.role,
    matchedLocation,
    matches,
    missing,
    exclusions,
  };
}
