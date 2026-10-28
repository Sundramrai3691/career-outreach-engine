import { PrismaClient } from '@prisma/client';
import { isIP } from 'node:net';
import { createHash } from 'node:crypto';
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
import { CandidateProfileInput, EMPTY_CANDIDATE_PROFILE, scoreJobFit } from './job-fit.service.js';

function normalizeText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

function normalizeLocation(value: string): string {
  return normalizeText(value)
    .replace(/\bunited states(?: of america)?\b|\busa\b/g, 'us')
    .replace(/\bunited kingdom\b|\bgreat britain\b|\buk\b/g, 'uk');
}

function materialFingerprint(posting: PublicJobPosting): string {
  const description = (posting.description || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return createHash('sha256').update(JSON.stringify({
    title: normalizeText(posting.title),
    location: normalizeLocation(posting.location || ''),
    description,
  })).digest('hex');
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
    targetLocations: string[],
    candidateProfile: CandidateProfileInput = EMPTY_CANDIDATE_PROFILE
  ): Promise<JobDiscoveryOutcome> {
    await this.prisma.discoveryRunItem.update({
      where: { id: runItemId },
      data: { jobDiscoveryStatus: 'searching', jobDiscoveryMessage: null },
    });

    const providersTried: JobDiscoveryOutcome['providersTried'] = [];
    const successfulScans: Array<{ sourceId: string; scanId: string; seenKeys: Set<string>; postingsCount: number; matchedCount: number }> = [];
    let successfulSources = 0;

    try {
      const domain = NormalizerService.normalizeDomain(company.domain) ||
        this.domainFromCareersUrl(company.careersUrl);
      const configured = domain
        ? this.registry.filter((entry) => entry.domain === domain)
        : [];
      const sourceProviders: Array<{ provider: JobSourceProvider; identifier: string; careersUrl?: string }> = configured.map((configuration) => ({
        provider: this.providerFactory(configuration),
        identifier: configuration.board,
      }));
      if (domain && company.careersUrl && !isPublicWebUrl(company.careersUrl)) {
        providersTried.push({
          provider: 'official_careers',
          status: 'unsupported_source',
          reason: 'The supplied careers URL is not a public HTTP(S) URL.',
        });
      } else if (domain && isPublicWebUrl(`https://${domain}/`)) {
        sourceProviders.push({
          provider: this.officialProviderFactory(domain, company.careersUrl),
          identifier: domain,
          careersUrl: company.careersUrl || `https://${domain}/`,
        });
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

      for (const sourceEntry of sourceProviders) {
        const { provider } = sourceEntry;
        const sourceRecord = await this.prisma.companyJobSource.upsert({
          where: { companyId_provider_identifier: {
            companyId: company.id,
            provider: provider.name,
            identifier: sourceEntry.identifier,
          } },
          update: { careersUrl: sourceEntry.careersUrl || null },
          create: {
            companyId: company.id,
            provider: provider.name,
            identifier: sourceEntry.identifier,
            careersUrl: sourceEntry.careersUrl || null,
          },
        });
        const scan = await this.prisma.jobSourceScan.create({
          data: { sourceId: sourceRecord.id, runItemId, status: 'running' },
        });
        try {
          const postings = await provider.discover({
            ...company,
            domain: company.domain || domain,
          });
          if (postings.some((posting) => !posting || typeof posting.title !== 'string' ||
            !isPublicWebUrl(posting.jobUrl) || !isPublicWebUrl(posting.sourceUrl))) {
            throw new JobSourceError('Source returned a posting with invalid title or non-public URL; scan is incomplete.', 'provider_failure');
          }
          successfulSources++;
          const profile = {
            ...candidateProfile,
            targetRoles: candidateProfile.targetRoles.length ? candidateProfile.targetRoles : targetRoles,
            locations: candidateProfile.locations.length ? candidateProfile.locations : targetLocations,
          };
          const seenKeys = new Set<string>();
          let matchedCount = 0;
          for (const posting of postings) {
            const normalizedUrl = normalizeJobUrl(posting.jobUrl);
            const externalId = posting.externalId?.trim() || undefined;
            const dedupeKey = externalId
              ? `external:${provider.name}:${externalId}`
              : `url:${normalizedUrl}`;
            seenKeys.add(dedupeKey);
            const fit = scoreJobFit(posting, profile, targetRoles);
            if (fit.included) matchedCount++;
            const fitStatus = !fit.included
              ? 'excluded'
              : fit.matches.some((detail) => !detail.startsWith('Role matches'))
              ? 'eligible'
              : 'needs_review';

            const fingerprint = materialFingerprint(posting);
            const previous = await this.prisma.jobOpening.findUnique({
              where: { companyId_dedupeKey: { companyId: company.id, dedupeKey } },
            });
            let changeType: 'new' | 'updated' | 'reopened' | 'unchanged' = 'unchanged';
            let changeReason = 'No material changes detected.';
            if (!previous) {
              changeType = 'new';
              changeReason = 'First successful observation of this posting identity.';
            } else if (previous.status === 'removed') {
              changeType = 'reopened';
              changeReason = 'Posting reappeared after being absent from two successful scans.';
            } else if (previous.materialFingerprint !== fingerprint) {
              changeType = 'updated';
              const changed: string[] = [];
              if (previous.normalizedTitle !== normalizeText(posting.title)) changed.push('title');
              if ((previous.normalizedLocation || '') !== normalizeText(posting.location || '')) changed.push('location');
              if ((previous.description || '') !== (posting.description || '')) changed.push('description');
              changeReason = `Material posting content changed${changed.length ? `: ${changed.join(', ')}` : ''}.`;
            }

            const now = new Date();
            const opening = await this.prisma.jobOpening.upsert({
              where: { companyId_dedupeKey: { companyId: company.id, dedupeKey } },
              update: {
                normalizedCompanyName: normalizeText(NormalizerService.normalizeCompanyName(company.name)),
                sourceProvider: provider.name,
                sourceUrl: posting.sourceUrl,
                jobUrl: posting.jobUrl,
                normalizedJobUrl: normalizedUrl,
                externalId: externalId || null,
                originalTitle: posting.title.trim(),
                normalizedTitle: normalizeText(posting.title),
                originalLocation: posting.location?.trim() || null,
                normalizedLocation: posting.location ? normalizeText(posting.location) : null,
                description: posting.description || null,
                materialFingerprint: fingerprint,
                status: 'active',
                lastChangeType: changeType,
                lastChangeReason: changeReason,
                missingSuccessfulScans: 0,
                lastRemovalScanAt: null,
                companyJobSourceId: sourceRecord.id,
                lastSeenAt: now,
                lastCheckedAt: now,
              },
              create: {
                companyId: company.id,
                companyJobSourceId: sourceRecord.id,
                normalizedCompanyName: normalizeText(NormalizerService.normalizeCompanyName(company.name)),
                sourceProvider: provider.name,
                sourceUrl: posting.sourceUrl,
                jobUrl: posting.jobUrl,
                normalizedJobUrl: normalizedUrl,
                externalId: externalId || null,
                dedupeKey,
                originalTitle: posting.title.trim(),
                normalizedTitle: normalizeText(posting.title),
                originalLocation: posting.location?.trim() || null,
                normalizedLocation: posting.location ? normalizeText(posting.location) : null,
                description: posting.description || null,
                materialFingerprint: fingerprint,
                status: 'active',
                lastChangeType: changeType,
                lastChangeReason: changeReason,
                firstSeenAt: now,
                lastSeenAt: now,
                lastCheckedAt: now,
              },
            });

            if (changeType !== 'unchanged') {
              await this.prisma.jobOpeningEvent.create({
                data: {
                  jobOpeningId: opening.id,
                  eventType: changeType,
                  reason: changeReason,
                  previousJson: previous ? JSON.stringify({ title: previous.originalTitle, location: previous.originalLocation, description: previous.description, status: previous.status }) : null,
                  currentJson: JSON.stringify({ title: posting.title, location: posting.location || null, description: posting.description || null, status: 'active' }),
                },
              });
            }

            await this.prisma.jobOpeningDiscovery.upsert({
              where: { jobOpeningId_discoveryRunItemId: { jobOpeningId: opening.id, discoveryRunItemId: runItemId } },
              update: {
                matchedRole: fit.matchedRole || '',
                matchedLocation: fit.matchedLocation || null,
                fitScore: fit.score,
                fitStatus,
                fitDetailsJson: JSON.stringify({ matches: fit.matches, missing: fit.missing, exclusions: fit.exclusions }),
                changeType,
                changeReason,
              },
              create: {
                jobOpeningId: opening.id,
                discoveryRunItemId: runItemId,
                matchedRole: fit.matchedRole || '',
                matchedLocation: fit.matchedLocation || null,
                fitScore: fit.score,
                fitStatus,
                fitDetailsJson: JSON.stringify({ matches: fit.matches, missing: fit.missing, exclusions: fit.exclusions }),
                changeType,
                changeReason,
              },
            });
          }

          successfulScans.push({ sourceId: sourceRecord.id, scanId: scan.id, seenKeys, postingsCount: postings.length, matchedCount });
          const sourceStatus = postings.length > 0 ? 'success' : 'no_matches';
          await this.prisma.companyJobSource.update({
            where: { id: sourceRecord.id },
            data: {
              isValidated: true,
              status: sourceStatus,
              lastScanAt: new Date(),
              lastSuccessfulScanAt: new Date(),
              latestError: null,
              lastJobCount: postings.length,
            },
          });
          await this.prisma.jobSourceScan.update({
            where: { id: scan.id },
            data: { status: 'success', completedAt: new Date(), postingsCount: postings.length, matchedCount },
          });
          providersTried.push({
            provider: provider.name,
            status: postings.length > 0 ? 'found' : 'no_matches',
            reason: postings.length === 0 ? 'Source returned no public job postings.' : `${postings.length} posting(s) checked; ${matchedCount} matched candidate criteria.`,
          });
        } catch (error) {
          const sourceError = error instanceof JobSourceError
            ? error
            : new JobSourceError(error instanceof Error ? error.message : String(error), 'provider_failure');
          providersTried.push({
            provider: provider.name,
            status: sourceError.kind,
            reason: sourceError.message,
          });
          await this.prisma.companyJobSource.update({
            where: { id: sourceRecord.id },
            data: {
              status: sourceError.kind,
              lastScanAt: new Date(),
              lastFailureAt: new Date(),
              latestError: sourceError.message,
            },
          });
          await this.prisma.jobSourceScan.update({
            where: { id: scan.id },
            data: { status: sourceError.kind, completedAt: new Date(), errorMessage: sourceError.message },
          });
        }
      }
      const now = new Date();

      const hadFailedSource = providersTried.some((attempt) => ['rate_limited', 'provider_failure', 'blocked'].includes(attempt.status));
      if (!hadFailedSource) {
        for (const scan of successfulScans) {
          const openings = await this.prisma.jobOpening.findMany({ where: { companyJobSourceId: scan.sourceId, status: 'active' } });
          for (const opening of openings) {
            if (scan.seenKeys.has(opening.dedupeKey)) continue;
            const missingSuccessfulScans = (opening.missingSuccessfulScans || 0) + 1;
            const remove = missingSuccessfulScans >= 2;
            const reason = remove
              ? 'Absent from two consecutive successful scans of its source.'
              : 'Absent from one successful scan; retained pending confirmation.';
            await this.prisma.jobOpening.update({
              where: { id: opening.id },
              data: {
                missingSuccessfulScans,
                lastRemovalScanAt: now,
                lastCheckedAt: now,
                ...(remove ? { status: 'removed', lastChangeType: 'removed', lastChangeReason: reason } : {}),
              },
            });
            if (remove) {
              await this.prisma.jobOpeningEvent.create({
                data: {
                  jobOpeningId: opening.id,
                  eventType: 'removed',
                  reason,
                  previousJson: JSON.stringify({ status: 'active', title: opening.originalTitle, location: opening.originalLocation }),
                  currentJson: JSON.stringify({ status: 'removed' }),
                },
              });
            }
          }
        }
      }

      const hasErrors = providersTried.some((attempt) => ['rate_limited', 'provider_failure', 'blocked'].includes(attempt.status));
      let status: JobDiscoveryOutcome['status'];
      let message: string;
      const jobsFound = successfulScans.reduce((count, scan) => count + scan.matchedCount, 0);
      if (successfulSources > 0 && hasErrors) {
        status = 'partial_results';
        message = `${jobsFound} matching job(s) saved; one or more sources could not be checked. Removal detection was skipped.`;
      } else if (jobsFound > 0) {
        status = 'matched';
        message = `${jobsFound} matching job(s) saved.`;
      } else if (providersTried.some((attempt) => attempt.status === 'rate_limited')) {
        status = 'rate_limited';
        message = 'Search was rate limited; no complete result is available.';
      } else if (providersTried.some((attempt) => attempt.status === 'blocked')) {
        status = 'blocked';
        message = 'A public source denied access or its robots policy blocked this scan.';
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
          jobsFound,
        },
      });
      return { status, jobsFound, message, providersTried };
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
