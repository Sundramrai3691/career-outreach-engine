import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { GreenhouseJobsProvider } from '../../src/providers/job-discovery/greenhouse.provider.js';
import { LeverJobsProvider } from '../../src/providers/job-discovery/lever.provider.js';
import { OfficialCareersProvider } from '../../src/providers/job-discovery/official-careers.provider.js';
import { JobDiscoveryService, matchesJobLocation } from '../../src/services/job-discovery/job-discovery.service.js';
import { JobSourceError, JobSourceProvider, PublicJobPosting } from '../../src/services/job-discovery/job.types.js';

const greenhouseFixture = JSON.parse(readFileSync(new URL('../fixtures/greenhouse-jobs.json', import.meta.url), 'utf8'));
const leverFixture = JSON.parse(readFileSync(new URL('../fixtures/lever-postings.json', import.meta.url), 'utf8'));

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
      .rejects.toMatchObject({ kind: 'unsupported_source' });
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
});

describe('job discovery persistence and outcomes', () => {
  function makePrisma() {
    const openings = new Map<string, any>();
    const prisma = {
      discoveryRunItem: { update: vi.fn().mockResolvedValue({}) },
      jobOpening: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert: vi.fn(async ({ where, create, update }: any) => {
          const key = where.companyId_dedupeKey.dedupeKey;
          if (!openings.has(key)) openings.set(key, { id: `job-${openings.size + 1}`, ...create });
          else Object.assign(openings.get(key), update);
          return openings.get(key);
        }),
      },
      jobOpeningDiscovery: {
        upsert: vi.fn().mockResolvedValue({}),
      },
      openings,
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
    expect(rateResult.status).toBe('rate_limited');

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
  });
});
