import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { GreenhouseJobsProvider } from '../../src/providers/job-discovery/greenhouse.provider.js';
import { LeverJobsProvider } from '../../src/providers/job-discovery/lever.provider.js';
import { OfficialCareersProvider } from '../../src/providers/job-discovery/official-careers.provider.js';
import { JobDiscoveryService, matchesJobLocation } from '../../src/services/job-discovery/job-discovery.service.js';
import { JobSourceError, JobSourceProvider, PublicJobPosting } from '../../src/services/job-discovery/job.types.js';
import { CandidateProfileInput, scoreJobFit } from '../../src/services/job-discovery/job-fit.service.js';
import { summarizeJobSourceCoverage } from '../../src/services/job-discovery/job-coverage.service.js';
import { summarizeJobSourceCoverage } from '../../src/services/job-discovery/job-coverage.service.js';

const greenhouseFixture = JSON.parse(readFileSync(new URL('../fixtures/greenhouse-jobs.json', import.meta.url), 'utf8'));
const leverFixture = JSON.parse(readFileSync(new URL('../fixtures/lever-postings.json', import.meta.url), 'utf8'));
const jobFitExamples = JSON.parse(readFileSync(new URL('../fixtures/job-fit-examples.json', import.meta.url), 'utf8')) as Array<{ label: string; title: string; location: string; description: string }>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('public job provider response fixtures', () => {
  it('maps the Greenhouse public board API response and requests job content', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(greenhouseFixture));
    vi.stubGlobal('fetch', fetchMock);
    const postings = await new GreenhouseJobsProvider('acme-board').discover({
      id: 'co-1',
      name: 'Acme',
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://boards-api.greenhouse.io/v1/boards/acme-board/jobs?content=true'
    );
    expect(postings).toEqual([{
      externalId: '481516',
      title: 'Senior Software Engineer',
      location: 'San Francisco, CA',
      description: '<p>Build reliable products with our engineering team.</p>',
      jobUrl: 'https://boards.greenhouse.io/acme/jobs/481516',
      sourceUrl: 'https://boards-api.greenhouse.io/v1/boards/acme-board/jobs?content=true',
    }]);
  });

  it('maps the Lever public postings endpoint response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(leverFixture));
    vi.stubGlobal('fetch', fetchMock);
    const postings = await new LeverJobsProvider('acme-site').discover({
      id: 'co-1',
      name: 'Acme',
    });

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.lever.co/v0/postings/acme-site?mode=json');
    expect(postings[0]).toMatchObject({
      externalId: 'lever-post-123',
      title: 'Product Manager',
      location: 'Remote - United States',
      description: 'Own product direction.',
      jobUrl: 'https://jobs.lever.co/acme/lever-post-123',
    });
  });

  it('classifies provider failures, missing boards, invalid payloads, and rate limits', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 429)));
    await expect(new GreenhouseJobsProvider('board').discover({ id: 'c', name: 'Company' }))
      .rejects.toMatchObject({ kind: 'rate_limited' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 404)));
    await expect(new LeverJobsProvider('site').discover({ id: 'c', name: 'Company' }))
      .rejects.toMatchObject({ kind: 'unsupported_source' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ notJobs: [] })));
    await expect(new GreenhouseJobsProvider('board').discover({ id: 'c', name: 'Company' }))
      .rejects.toMatchObject({ kind: 'provider_failure' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ jobs: [{ id: 1 }] })));
    await expect(new GreenhouseJobsProvider('board').discover({ id: 'c', name: 'Company' }))
      .rejects.toMatchObject({ kind: 'provider_failure' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 403)));
    await expect(new LeverJobsProvider('site').discover({ id: 'c', name: 'Company' }))
      .rejects.toMatchObject({ kind: 'blocked' });
  });
});

describe('official careers fallback', () => {
  it('extracts only job links from a robots-allowed official careers page', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('User-agent: *\nDisallow: /private', { status: 200 }))
      .mockResolvedValueOnce(new Response(
        '<html><ul><li><a href="/careers/jobs/engineer">Software Engineer</a> · San Francisco, CA</li></ul></html>',
        { status: 200, headers: { 'Content-Type': 'text/html' }, url: 'https://acme.example/careers' }
      ));
    vi.stubGlobal('fetch', fetchMock);

    const postings = await new OfficialCareersProvider('acme.example', 'https://acme.example/careers')
      .discover({ id: 'co-1', name: 'Acme' });

    expect(postings).toHaveLength(1);
    expect(postings[0].title).toBe('Software Engineer');
    expect(postings[0].jobUrl).toBe('https://acme.example/careers/jobs/engineer');
    expect(postings[0].sourceUrl).toBe('https://acme.example/careers');
  });

  it('does not fetch a path disallowed by robots.txt', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('User-agent: *\nDisallow: /careers', { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(new OfficialCareersProvider('acme.example', 'https://acme.example/careers')
      .discover({ id: 'co-1', name: 'Acme' }))
      .rejects.toMatchObject({ kind: 'blocked' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('follows a discovered same-domain careers landing link to find individual postings', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('User-agent: *\nDisallow:', { status: 200 }))
      .mockResolvedValueOnce(new Response('<a href="/careers">Careers</a>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }))
      .mockResolvedValueOnce(new Response('<a href="/careers/jobs/data-engineer">Data Engineer</a>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const postings = await new OfficialCareersProvider('fallback.example')
      .discover({ id: 'co-1', name: 'Fallback Inc.' });

    expect(postings).toHaveLength(1);
    expect(postings[0].title).toBe('Data Engineer');
    expect(postings[0].sourceUrl).toBe('https://fallback.example/careers');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('role and location matching', () => {
  it('matches selected locations deterministically and rejects missing location evidence', () => {
    expect(matchesJobLocation('San Francisco, CA · Hybrid', ['San Francisco, CA']))
      .toEqual({ matches: true, matchedLocation: 'San Francisco, CA' });
    expect(matchesJobLocation('Remote - United States', ['Remote (US)']).matches).toBe(true);
    expect(matchesJobLocation('Remote - EMEA', ['Remote (US)']).matches).toBe(false);
    expect(matchesJobLocation('Remote', ['Remote (US)']).matches).toBe(false);
    expect(matchesJobLocation(undefined, ['San Francisco, CA']).matches).toBe(false);
    expect(matchesJobLocation('London, UK', ['San Francisco, CA']).matches).toBe(false);
    expect(matchesJobLocation(undefined, []).matches).toBe(true);
  });

  it('scores graduate software examples and explains hard exclusions', () => {
    const profile: CandidateProfileInput = {
      targetRoles: ['Software Engineer', 'Backend Engineer'],
      excludedRoles: ['Senior'],
      technicalSkills: ['Python', 'SQL', 'React'],
      requiredSkills: ['Python'],
      graduationYear: 2027,
      eligibleGraduationYearMin: 2026,
      eligibleGraduationYearMax: 2028,
      experienceLevels: ['new_grad', 'junior'],
      locations: ['Remote (US)'],
      remotePreference: 'remote_preferred',
      excludedLocations: [],
    };
    const newGrad = scoreJobFit({
      title: 'Software Engineer, University Graduate',
      location: 'Remote - United States',
      description: '<p>Class of 2027. Entry-level role using Python and SQL.</p>',
    }, profile);
    expect(newGrad.included).toBe(true);
    expect(newGrad.score).toBeGreaterThan(70);
    expect(newGrad.matches.some((detail) => detail.includes('Graduation year 2027'))).toBe(true);

    const rangeMismatch = scoreJobFit(jobFitExamples[0], {
      ...profile,
      graduationYear: null,
      eligibleGraduationYearMin: 2028,
      eligibleGraduationYearMax: 2030,
    });
    expect(rangeMismatch.included).toBe(false);
    expect(rangeMismatch.exclusions.some((detail) => detail.includes('2027'))).toBe(true);

    const remoteScopeMismatch = scoreJobFit({
      title: 'Software Engineer',
      location: 'Remote - EMEA',
      description: 'Python and SQL role.',
    }, { ...profile, technicalSkills: ['Python'], requiredSkills: ['Python'] });
    expect(remoteScopeMismatch.included).toBe(false);
    expect(remoteScopeMismatch.exclusions.some((detail) => detail.includes('Remote (US)'))).toBe(true);

    const seniorAiRole = scoreJobFit({
      title: 'Senior Machine Learning Engineer',
      location: 'New York, NY',
      description: 'Requires 8 years of experience, PyTorch, and a PhD.',
    }, profile);
    expect(seniorAiRole.included).toBe(false);
    expect(seniorAiRole.exclusions.some((detail) => detail.includes('Senior'))).toBe(true);
    expect(seniorAiRole.exclusions.some((detail) => detail.includes('Python'))).toBe(true);

    const backend = jobFitExamples.find((example) => example.label === 'backend engineer')!;
    const backendFit = scoreJobFit(backend, {
      ...profile,
      targetRoles: ['Backend Engineer'],
      excludedRoles: [],
      technicalSkills: ['Python', 'PostgreSQL'],
      requiredSkills: ['Python'],
      locations: ['San Francisco, CA'],
      remotePreference: 'any',
    });
    expect(backendFit.included).toBe(true);
    expect(backendFit.matches.some((detail) => detail.includes('Skills found'))).toBe(true);

    const aiRole = jobFitExamples.find((example) => example.label === 'AI and machine learning engineer')!;
    const aiFit = scoreJobFit(aiRole, {
      ...profile,
      targetRoles: ['AI/ML Engineer'],
      excludedRoles: [],
      technicalSkills: ['Python', 'PyTorch'],
      requiredSkills: ['Python'],
      locations: ['New York, NY'],
      remotePreference: 'any',
    });
    expect(aiFit.included).toBe(true);
    expect(aiFit.score).toBeGreaterThan(50);
  });
});

describe('company source coverage', () => {
  it('uses the entire watchlist as the exact coverage denominator and reports failures separately', () => {
    const summary = summarizeJobSourceCoverage([
      { companyId: '1', companyName: 'Validated', sources: [{ provider: 'greenhouse', isValidated: true, status: 'success', lastSuccessfulScanAt: new Date(), lastJobCount: 2 }] },
      { companyId: '2', companyName: 'Empty', sources: [{ provider: 'official_careers', isValidated: true, status: 'no_matches', lastSuccessfulScanAt: new Date(), lastJobCount: 0 }] },
      { companyId: '3', companyName: 'Unsupported', sources: [] },
      { companyId: '4', companyName: 'Failing', sources: [{ provider: 'lever', isValidated: false, status: 'rate_limited', lastJobCount: 0 }] },
    ]);
    expect(summary).toEqual({
      totalCompanies: 4,
      validatedMonitorable: 2,
      successfullyScanned: 2,
      zeroJobsAfterSuccessfulScan: 1,
      unsupportedOrUnconfigured: 1,
      failing: 1,
      coveragePercent: 50,
      coverageDenominator: 4,
    });
    expect(summarizeJobSourceCoverage([]).coveragePercent).toBe(0);
  });
});

describe('company source coverage', () => {
  it('uses the entire watchlist as the exact coverage denominator and reports failures separately', () => {
    const summary = summarizeJobSourceCoverage([
      { companyId: '1', companyName: 'Validated', sources: [{ provider: 'greenhouse', isValidated: true, status: 'success', lastSuccessfulScanAt: new Date(), lastJobCount: 2 }] },
      { companyId: '2', companyName: 'Empty', sources: [{ provider: 'official_careers', isValidated: true, status: 'no_matches', lastSuccessfulScanAt: new Date(), lastJobCount: 0 }] },
      { companyId: '3', companyName: 'Unsupported', sources: [] },
      { companyId: '4', companyName: 'Failing', sources: [{ provider: 'lever', isValidated: false, status: 'rate_limited', lastJobCount: 0 }] },
    ]);
    expect(summary).toEqual({
      totalCompanies: 4,
      validatedMonitorable: 2,
      successfullyScanned: 2,
      zeroJobsAfterSuccessfulScan: 1,
      unsupportedOrUnconfigured: 1,
      failing: 1,
      coveragePercent: 50,
      coverageDenominator: 4,
    });
    expect(summarizeJobSourceCoverage([]).coveragePercent).toBe(0);
  });
});

describe('job discovery persistence and outcomes', () => {
  function makePrisma() {
    const openings = new Map<string, any>();
    const sources = new Map<string, any>();
    const scans = new Map<string, any>();
    const events: any[] = [];
    const discoveries: any[] = [];
    const prisma = {
      discoveryRunItem: { update: vi.fn().mockResolvedValue({}) },
      jobOpening: {
        findUnique: vi.fn(async ({ where }: any) => openings.get(where.companyId_dedupeKey.dedupeKey) || null),
        findMany: vi.fn(async ({ where }: any) => Array.from(openings.values()).filter((job) =>
          job.companyJobSourceId === where.companyJobSourceId && job.status === where.status)),
        update: vi.fn(async ({ where, data }: any) => {
          const row = Array.from(openings.values()).find((job) => job.id === where.id);
          Object.assign(row, data);
          return row;
        }),
        upsert: vi.fn(async ({ where, create, update }: any) => {
          const key = where.companyId_dedupeKey.dedupeKey;
          if (!openings.has(key)) openings.set(key, { id: `job-${openings.size + 1}`, ...create });
          else Object.assign(openings.get(key), update);
          return openings.get(key);
        }),
      },
      companyJobSource: {
        upsert: vi.fn(async ({ where, create, update }: any) => {
          const key = `${where.companyId_provider_identifier.companyId}:${where.companyId_provider_identifier.provider}:${where.companyId_provider_identifier.identifier}`;
          if (!sources.has(key)) sources.set(key, { id: `source-${sources.size + 1}`, ...create });
          else Object.assign(sources.get(key), update);
          return sources.get(key);
        }),
        update: vi.fn(async ({ where, data }: any) => {
          const row = Array.from(sources.values()).find((source) => source.id === where.id);
          Object.assign(row, data);
          return row;
        }),
      },
      jobSourceScan: {
        create: vi.fn(async ({ data }: any) => {
          const row = { id: `scan-${scans.size + 1}`, ...data };
          scans.set(row.id, row);
          return row;
        }),
        update: vi.fn(async ({ where, data }: any) => Object.assign(scans.get(where.id), data)),
      },
      jobOpeningEvent: { create: vi.fn(async ({ data }: any) => { events.push(data); return data; }) },
      jobOpeningDiscovery: { upsert: vi.fn(async ({ create, update }: any) => { discoveries.push(create || update); return create || update; }) },
      openings,
      sources,
      scans,
      events,
      discoveries,
    };
    return prisma;
  }

  const posting: PublicJobPosting = {
    externalId: 'stable-42',
    title: 'Senior Software Engineer',
    location: 'San Francisco, CA',
    description: 'Original description.',
    jobUrl: 'https://jobs.example.com/42?utm_source=test',
    sourceUrl: 'https://api.example.com/public/jobs',
  };

  it('matches selected roles and locations and deduplicates repeat runs by external ID', async () => {
    const prisma = makePrisma();
    const greenhouse: JobSourceProvider = {
      name: 'greenhouse',
      discover: vi.fn().mockResolvedValue([posting]),
    };
    const official: JobSourceProvider = {
      name: 'official_careers',
      discover: vi.fn().mockResolvedValue([]),
    };
    const service = new JobDiscoveryService(
      prisma as unknown as PrismaClient,
      [{ domain: 'example.com', provider: 'greenhouse', board: 'configured-board' }],
      () => greenhouse,
      () => official
    );
    const company = { id: 'company-1', name: 'Acme, Inc.', domain: 'example.com' };

    const first = await service.discoverForRunItem('run-item-1', company, ['Software Engineer'], ['San Francisco, CA']);
    const second = await service.discoverForRunItem('run-item-2', company, ['Software Engineer'], ['San Francisco, CA']);

    expect(first.status).toBe('matched');
    expect(second.jobsFound).toBe(1);
    expect(prisma.jobOpening.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.openings.size).toBe(1);
    expect(prisma.jobOpeningDiscovery.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.discoveries[0].fitStatus).toBe('eligible');
    expect(prisma.openings.values().next().value).toMatchObject({
      originalTitle: 'Senior Software Engineer',
      normalizedTitle: 'senior software engineer',
      normalizedJobUrl: 'https://jobs.example.com/42',
      description: 'Original description.',
      externalId: 'stable-42',
    });
  });

  it('reports no matches, rate limiting, partial results, and unsupported sources honestly', async () => {
    const makeService = (board: JobSourceProvider, official: JobSourceProvider) => {
      const prisma = makePrisma();
      return new JobDiscoveryService(
        prisma as unknown as PrismaClient,
        [{ domain: 'example.com', provider: 'greenhouse', board: 'board' }],
        () => board,
        () => official
      );
    };
    const noResults: JobSourceProvider = { name: 'greenhouse', discover: vi.fn().mockResolvedValue([]) };
    const noOfficialResults: JobSourceProvider = { name: 'official_careers', discover: vi.fn().mockResolvedValue([]) };
    const noMatch = await makeService(noResults, noOfficialResults)
      .discoverForRunItem('item', { id: 'company', name: 'Acme', domain: 'example.com' }, ['Engineer'], []);
    expect(noMatch.status).toBe('no_matches');

    const rateLimited: JobSourceProvider = {
      name: 'greenhouse',
      discover: vi.fn().mockRejectedValue(new JobSourceError('Too many requests', 'rate_limited')),
    };
    const rateResult = await makeService(rateLimited, noOfficialResults)
      .discoverForRunItem('item', { id: 'company', name: 'Acme', domain: 'example.com' }, ['Engineer'], []);
    expect(rateResult.status).toBe('partial_results');

    const partial = await makeService(
      { name: 'greenhouse', discover: vi.fn().mockResolvedValue([posting]) },
      { name: 'official_careers', discover: vi.fn().mockRejectedValue(new JobSourceError('Denied', 'provider_failure')) }
    ).discoverForRunItem('item', { id: 'company', name: 'Acme', domain: 'example.com' }, ['Software Engineer'], []);
    expect(partial.status).toBe('partial_results');

    const unsupported = await makeService({
      name: 'greenhouse',
      discover: vi.fn().mockRejectedValue(new JobSourceError('Board unavailable', 'unsupported_source')),
    }, {
      name: 'official_careers',
      discover: vi.fn().mockRejectedValue(new JobSourceError('No careers page', 'unsupported_source')),
    }).discoverForRunItem('item', { id: 'company', name: 'Acme', domain: 'example.com' }, ['Engineer'], []);
    expect(unsupported.status).toBe('unsupported_source');

    const providerFailure = await makeService({
      name: 'greenhouse',
      discover: vi.fn().mockRejectedValue(new JobSourceError('Network unavailable', 'provider_failure')),
    }, {
      name: 'official_careers',
      discover: vi.fn().mockRejectedValue(new JobSourceError('Network unavailable', 'provider_failure')),
    }).discoverForRunItem('item', { id: 'company', name: 'Acme', domain: 'example.com' }, ['Engineer'], []);
    expect(providerFailure.status).toBe('provider_failure');
  });

  it('uses the canonical posting URL as its deterministic deduplication fallback', async () => {
    const prisma = makePrisma();
    const noExternalId = { ...posting, externalId: undefined };
    const board: JobSourceProvider = {
      name: 'greenhouse',
      discover: vi.fn().mockResolvedValue([noExternalId]),
    };
    const service = new JobDiscoveryService(
      prisma as unknown as PrismaClient,
      [{ domain: 'example.com', provider: 'greenhouse', board: 'board' }],
      () => board,
      () => ({ name: 'official_careers', discover: vi.fn().mockResolvedValue([]) })
    );
    const company = { id: 'company-1', name: 'Acme', domain: 'example.com' };
    await service.discoverForRunItem('run-1', company, ['Software Engineer'], []);
    await service.discoverForRunItem('run-2', company, ['Software Engineer'], []);

    expect(prisma.openings.size).toBe(1);
    expect(Array.from(prisma.openings.keys())[0]).toBe('url:https://jobs.example.com/42');
    expect(prisma.discoveries[0].fitStatus).toBe('needs_review');
  });

  it('classifies new, unchanged, updated, removed, and reopened jobs and ignores incomplete scans for removal', async () => {
    const prisma = makePrisma();
    let current: PublicJobPosting[] = [posting];
    let fail = false;
    const board: JobSourceProvider = {
      name: 'greenhouse',
      discover: vi.fn(async () => {
        if (fail) throw new JobSourceError('Temporary network failure', 'provider_failure');
        return current;
      }),
    };
    const official: JobSourceProvider = { name: 'official_careers', discover: vi.fn().mockResolvedValue([]) };
    const service = new JobDiscoveryService(
      prisma as unknown as PrismaClient,
      [{ domain: 'example.com', provider: 'greenhouse', board: 'board' }],
      () => board,
      () => official
    );
    const company = { id: 'company-1', name: 'Acme', domain: 'example.com' };

    await service.discoverForRunItem('run-1', company, ['Software Engineer'], []);
    const job = prisma.openings.get('external:greenhouse:stable-42');
    expect(job.lastChangeType).toBe('new');

    await service.discoverForRunItem('run-2', company, ['Software Engineer'], []);
    expect(job.lastChangeType).toBe('unchanged');
    expect(prisma.openings.size).toBe(1);

    current = [{ ...posting, title: 'Senior Software Engineer', description: 'Updated posting content.' }];
    await service.discoverForRunItem('run-3', company, ['Software Engineer'], []);
    expect(job.lastChangeType).toBe('updated');

    fail = true;
    const failedRun = await service.discoverForRunItem('run-4', company, ['Software Engineer'], []);
    expect(failedRun.status).toBe('partial_results');
    expect(job.status).toBe('active');
    expect(job.missingSuccessfulScans).toBe(0);

    fail = false;
    current = [];
    await service.discoverForRunItem('run-5', company, ['Software Engineer'], []);
    expect(job.status).toBe('active');
    expect(job.missingSuccessfulScans).toBe(1);
    await service.discoverForRunItem('run-6', company, ['Software Engineer'], []);
    expect(job.status).toBe('removed');
    expect(job.lastChangeType).toBe('removed');

    current = [{ ...posting, title: 'Senior Software Engineer', description: 'Updated posting content.' }];
    await service.discoverForRunItem('run-7', company, ['Software Engineer'], []);
    expect(job.status).toBe('active');
    expect(job.lastChangeType).toBe('reopened');
    expect(prisma.events.map((event: any) => event.eventType)).toEqual(['new', 'updated', 'removed', 'reopened']);
  });
});
