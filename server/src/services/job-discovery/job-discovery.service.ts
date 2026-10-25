import { PrismaClient } from '@prisma/client';
import { isIP } from 'node:net';
import { NormalizerService } from '../normalizer.service.js';
import { GreenhouseJobsProvider } from '../../providers/job-discovery/greenhouse.provider.js';
import { LeverJobsProvider } from '../../providers/job-discovery/lever.provider.js';
import { OfficialCareersProvider } from '../../providers/job-discovery/official-careers.provider.js';
import {
  JobBoardConfiguration,
  JobCompanyTarget,
  JobDiscoveryOutcome,
  JobSourceError,
  JobSourceProvider,
  PublicJobPosting,
} from './job.types.js';

function normalizeText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

function normalizeLocation(value: string): string {
  return normalizeText(value)
    .replace(/\bunited states(?: of america)?\b|\busa\b/g, 'us')
    .replace(/\bunited kingdom\b|\bgreat britain\b|\buk\b/g, 'uk');
}

export function matchesJobLocation(
  postingLocation: string | undefined,
  requestedLocations: string[]
): { matches: boolean; matchedLocation?: string } {
  if (requestedLocations.length === 0) return { matches: true };
  if (!postingLocation?.trim()) return { matches: false };

  const posting = normalizeLocation(postingLocation);
  const isRemotePosting = /\bremote\b/.test(posting);
  for (const requestedLocation of requestedLocations) {
    const requested = normalizeLocation(requestedLocation);
    if (!requested) continue;
    const isRemoteRequested = /\bremote\b/.test(requested);
    if (isRemoteRequested && isRemotePosting) {
      const requestedScope = requested.replace(/\bremote\b/, '').trim();
      const postingScope = posting.replace(/\bremote\b/, '').trim();
      if (!requestedScope || (postingScope && postingScope.includes(requestedScope))) {
        return { matches: true, matchedLocation: requestedLocation };
      }
      continue;
    }
    if (
      requested === posting ||
      posting.includes(requested) ||
      requested.includes(posting)
    ) {
      return { matches: true, matchedLocation: requestedLocation };
    }
  }
  return { matches: false };
}

function normalizeJobUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.hash = '';
  for (const key of Array.from(url.searchParams.keys())) {
    if (/^(utm_.+|gh_src|lever-source|source)$/i.test(key)) url.searchParams.delete(key);
  }
  url.hostname = url.hostname.toLowerCase();
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  url.searchParams.sort();
  return url.toString();
}

function isPublicWebUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false;
    const ipVersion = isIP(host);
    if (ipVersion === 4) {
      const octets = host.split('.').map(Number);
      if (
        octets[0] === 10 ||
        octets[0] === 127 ||
        (octets[0] === 169 && octets[1] === 254) ||
        (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
        (octets[0] === 192 && octets[1] === 168) ||
        octets[0] === 0
      ) return false;
    }
    if (ipVersion === 6 && (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:'))) return false;
    return true;
  } catch {
    return false;
  }
}

export class JobDiscoveryService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly registry = JobDiscoveryService.readRegistry(),
    private readonly providerFactory: (configuration: JobBoardConfiguration) => JobSourceProvider =
      (configuration) => configuration.provider === 'greenhouse'
        ? new GreenhouseJobsProvider(configuration.board)
        : new LeverJobsProvider(configuration.board),
    private readonly officialProviderFactory: (domain: string, careersUrl?: string | null) => JobSourceProvider =
      (domain, careersUrl) => new OfficialCareersProvider(domain, careersUrl)
  ) {}

  static readRegistry(): JobBoardConfiguration[] {
    const raw = process.env.JOB_BOARD_REGISTRY?.trim();
    if (!raw) return [];
    const entries: unknown = JSON.parse(raw);
    if (!Array.isArray(entries)) throw new Error('JOB_BOARD_REGISTRY must be a JSON array.');
    return entries.map((entry) => {
      if (
        !entry ||
        typeof entry.domain !== 'string' ||
        typeof entry.board !== 'string' ||
        !['greenhouse', 'lever'].includes(entry.provider)
      ) {
        throw new Error('Each JOB_BOARD_REGISTRY item must contain domain, provider (greenhouse|lever), and board.');
      }
      const domain = NormalizerService.normalizeDomain(entry.domain);
      if (!domain || !entry.board.trim()) throw new Error('JOB_BOARD_REGISTRY contains an invalid domain or empty board identifier.');
      return { domain, provider: entry.provider, board: entry.board.trim() };
    });
  }

  async discoverForRunItem(
    runItemId: string,
    company: JobCompanyTarget,
    targetRoles: string[],
    targetLocations: string[]
  ): Promise<JobDiscoveryOutcome> {
    await this.prisma.discoveryRunItem.update({
      where: { id: runItemId },
      data: { jobDiscoveryStatus: 'searching', jobDiscoveryMessage: null },
    });

    const providersTried: JobDiscoveryOutcome['providersTried'] = [];
    const rawPostings: Array<{ provider: JobSourceProvider; posting: PublicJobPosting }> = [];
    let successfulSources = 0;

    try {
      const domain = NormalizerService.normalizeDomain(company.domain) ||
        this.domainFromCareersUrl(company.careersUrl);
      const configured = domain
        ? this.registry.filter((entry) => entry.domain === domain)
        : [];
      const sourceProviders = configured.map((configuration) => this.providerFactory(configuration));
      if (domain && company.careersUrl && !isPublicWebUrl(company.careersUrl)) {
        providersTried.push({
          provider: 'official_careers',
          status: 'unsupported_source',
          reason: 'The supplied careers URL is not a public HTTP(S) URL.',
        });
      } else if (domain && isPublicWebUrl(`https://${domain}/`)) {
        sourceProviders.push(this.officialProviderFactory(domain, company.careersUrl));
      } else {
        providersTried.push({
          provider: 'official_careers',
          status: 'unsupported_source',
          reason: 'No verified public company domain or careers URL is available.',
        });
      }

      if (sourceProviders.length === 0) {
        providersTried.push({
          provider: 'official_careers',
          status: 'unsupported_source',
          reason: 'No configured public job source is available for this company.',
        });
      }

      for (const provider of sourceProviders) {
        try {
          const postings = await provider.discover({
            ...company,
            domain: company.domain || domain,
          });
          successfulSources++;
          providersTried.push({
            provider: provider.name,
            status: postings.length > 0 ? 'found' : 'no_matches',
            reason: postings.length === 0 ? 'Source returned no public job postings.' : `${postings.length} posting(s) checked.`,
          });
          rawPostings.push(...postings.map((posting) => ({ provider, posting })));
        } catch (error) {
          const sourceError = error instanceof JobSourceError
            ? error
            : new JobSourceError(error instanceof Error ? error.message : String(error), 'provider_failure');
          providersTried.push({
            provider: provider.name,
            status: sourceError.kind,
            reason: sourceError.message,
          });
        }
      }

      const matching: Array<{
        provider: JobSourceProvider;
        posting: PublicJobPosting;
        matchedRole: string;
        matchedLocation?: string;
      }> = [];
      for (const { provider, posting } of rawPostings) {
        const roleMatch = targetRoles
          .map((role) => ({ role, result: NormalizerService.matchTargetRole(posting.title, [role]) }))
          .find(({ result }) => result.isMatch);
        if (!roleMatch) continue;

        const locationMatch = matchesJobLocation(posting.location, targetLocations);
        if (!locationMatch.matches) continue;
        if (!isPublicWebUrl(posting.jobUrl) || !isPublicWebUrl(posting.sourceUrl)) continue;

        matching.push({
          provider,
          posting,
          matchedRole: roleMatch.role,
          matchedLocation: locationMatch.matchedLocation,
        });
      }

      const now = new Date();
      await this.prisma.jobOpening.updateMany({
        where: { companyId: company.id },
        data: { lastCheckedAt: now },
      });

      for (const entry of matching) {
        const normalizedUrl = normalizeJobUrl(entry.posting.jobUrl);
        const externalId = entry.posting.externalId?.trim() || undefined;
        const dedupeKey = externalId
          ? `external:${entry.provider.name}:${externalId}`
          : `url:${normalizedUrl}`;
        const opening = await this.prisma.jobOpening.upsert({
          where: { companyId_dedupeKey: { companyId: company.id, dedupeKey } },
          update: {
            normalizedCompanyName: normalizeText(NormalizerService.normalizeCompanyName(company.name)),
            sourceProvider: entry.provider.name,
            sourceUrl: entry.posting.sourceUrl,
            jobUrl: entry.posting.jobUrl,
            normalizedJobUrl: normalizedUrl,
            externalId: externalId || null,
            originalTitle: entry.posting.title.trim(),
            normalizedTitle: normalizeText(entry.posting.title),
            originalLocation: entry.posting.location?.trim() || null,
            normalizedLocation: entry.posting.location ? normalizeText(entry.posting.location) : null,
            description: entry.posting.description || null,
            lastSeenAt: now,
            lastCheckedAt: now,
          },
          create: {
            companyId: company.id,
            normalizedCompanyName: normalizeText(NormalizerService.normalizeCompanyName(company.name)),
            sourceProvider: entry.provider.name,
            sourceUrl: entry.posting.sourceUrl,
            jobUrl: entry.posting.jobUrl,
            normalizedJobUrl: normalizedUrl,
            externalId: externalId || null,
            dedupeKey,
            originalTitle: entry.posting.title.trim(),
            normalizedTitle: normalizeText(entry.posting.title),
            originalLocation: entry.posting.location?.trim() || null,
            normalizedLocation: entry.posting.location ? normalizeText(entry.posting.location) : null,
            description: entry.posting.description || null,
            firstSeenAt: now,
            lastSeenAt: now,
            lastCheckedAt: now,
          },
        });
        await this.prisma.jobOpeningDiscovery.upsert({
          where: { jobOpeningId_discoveryRunItemId: { jobOpeningId: opening.id, discoveryRunItemId: runItemId } },
          update: { matchedRole: entry.matchedRole, matchedLocation: entry.matchedLocation || null },
          create: {
            jobOpeningId: opening.id,
            discoveryRunItemId: runItemId,
            matchedRole: entry.matchedRole,
            matchedLocation: entry.matchedLocation || null,
          },
        });
      }

      const hasErrors = providersTried.some((attempt) => ['rate_limited', 'provider_failure'].includes(attempt.status));
      let status: JobDiscoveryOutcome['status'];
      let message: string;
      if (matching.length > 0 && hasErrors) {
        status = 'partial_results';
        message = `${matching.length} matching job(s) saved; one or more sources could not be checked.`;
      } else if (matching.length > 0) {
        status = 'matched';
        message = `${matching.length} matching job(s) saved.`;
      } else if (providersTried.some((attempt) => attempt.status === 'rate_limited')) {
        status = 'rate_limited';
        message = 'Search was rate limited; no complete result is available.';
      } else if (providersTried.some((attempt) => attempt.status === 'provider_failure')) {
        status = 'provider_failure';
        message = 'The job search could not be completed because a source failed.';
      } else if (successfulSources > 0) {
        status = 'no_matches';
        message = 'Search completed; no postings matched the selected roles and locations.';
      } else {
        status = 'unsupported_source';
        message = 'No supported public job source or accessible official careers page was identified.';
      }

      await this.prisma.discoveryRunItem.update({
        where: { id: runItemId },
        data: {
          jobDiscoveryStatus: status,
          jobDiscoveryMessage: message,
          jobsFound: matching.length,
        },
      });
      return { status, jobsFound: matching.length, message, providersTried };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const outcome: JobDiscoveryOutcome = {
        status: 'provider_failure',
        jobsFound: 0,
        message: `Job discovery could not be completed: ${message}`,
        providersTried,
      };
      await this.prisma.discoveryRunItem.update({
        where: { id: runItemId },
        data: { jobDiscoveryStatus: outcome.status, jobDiscoveryMessage: outcome.message, jobsFound: 0 },
      });
      return outcome;
    }
  }

  private domainFromCareersUrl(careersUrl?: string | null): string | undefined {
    if (!careersUrl || !isPublicWebUrl(careersUrl)) return undefined;
    const url = new URL(careersUrl);
    return NormalizerService.normalizeDomain(url.hostname);
  }
}
