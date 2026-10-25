import {
  JobCompanyTarget,
  JobSourceError,
  JobSourceProvider,
  PublicJobPosting,
} from '../../services/job-discovery/job.types.js';

interface LeverPosting {
  id: string;
  text: string;
  categories?: { location?: string };
  hostedUrl: string;
  description?: string;
  descriptionPlain?: string;
}

export class LeverJobsProvider implements JobSourceProvider {
  readonly name = 'lever' as const;

  constructor(private readonly site: string) {}

  async discover(_company: JobCompanyTarget): Promise<PublicJobPosting[]> {
    const url = `https://api.lever.co/v0/postings/${encodeURIComponent(this.site)}?mode=json`;
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'CareerOutreachEngine/1.0' },
        signal: AbortSignal.timeout(10000),
      });
    } catch (error) {
      throw new JobSourceError(`Lever request failed: ${error instanceof Error ? error.message : String(error)}`, 'provider_failure');
    }

    if (response.status === 404) {
      throw new JobSourceError('Configured Lever site was not found.', 'unsupported_source');
    }
    if (response.status === 429) {
      throw new JobSourceError('Lever rate limit reached.', 'rate_limited');
    }
    if (!response.ok) {
      throw new JobSourceError(`Lever returned HTTP ${response.status}.`, 'provider_failure');
    }

    let payload: LeverPosting[];
    try {
      payload = await response.json() as LeverPosting[];
    } catch {
      throw new JobSourceError('Lever returned invalid JSON.', 'provider_failure');
    }
    if (!Array.isArray(payload)) {
      throw new JobSourceError('Lever response was not a postings array.', 'provider_failure');
    }

    return payload
      .filter((posting) => posting && typeof posting.id === 'string' && typeof posting.text === 'string' && typeof posting.hostedUrl === 'string')
      .map((posting) => ({
        externalId: posting.id,
        title: posting.text,
        location: posting.categories?.location,
        description: posting.descriptionPlain || posting.description,
        jobUrl: posting.hostedUrl,
        sourceUrl: url,
      }));
  }
}
