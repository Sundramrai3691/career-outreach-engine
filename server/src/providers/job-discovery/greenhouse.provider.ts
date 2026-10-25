import {
  JobCompanyTarget,
  JobSourceError,
  JobSourceProvider,
  PublicJobPosting,
} from '../../services/job-discovery/job.types.js';

interface GreenhouseJob {
  id: number | string;
  title: string;
  location?: { name?: string };
  absolute_url: string;
  content?: string;
  updated_at?: string;
}

export class GreenhouseJobsProvider implements JobSourceProvider {
  readonly name = 'greenhouse' as const;

  constructor(private readonly boardToken: string) {}

  async discover(_company: JobCompanyTarget): Promise<PublicJobPosting[]> {
    const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(this.boardToken)}/jobs?content=true`;
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'CareerOutreachEngine/1.0' },
        signal: AbortSignal.timeout(10000),
      });
    } catch (error) {
      throw new JobSourceError(`Greenhouse request failed: ${error instanceof Error ? error.message : String(error)}`, 'provider_failure');
    }

    if (response.status === 404) {
      throw new JobSourceError('Configured Greenhouse board was not found.', 'unsupported_source');
    }
    if (response.status === 429) {
      throw new JobSourceError('Greenhouse rate limit reached.', 'rate_limited');
    }
    if (!response.ok) {
      throw new JobSourceError(`Greenhouse returned HTTP ${response.status}.`, 'provider_failure');
    }

    let payload: { jobs?: GreenhouseJob[] };
    try {
      payload = await response.json() as { jobs?: GreenhouseJob[] };
    } catch {
      throw new JobSourceError('Greenhouse returned invalid JSON.', 'provider_failure');
    }
    if (!Array.isArray(payload.jobs)) {
      throw new JobSourceError('Greenhouse response did not contain a jobs array.', 'provider_failure');
    }

    return payload.jobs
      .filter((job) => job && job.id !== undefined && typeof job.title === 'string' && typeof job.absolute_url === 'string')
      .map((job) => ({
        externalId: String(job.id),
        title: job.title,
        location: job.location?.name,
        description: job.content,
        jobUrl: job.absolute_url,
        sourceUrl: url,
      }));
  }
}
