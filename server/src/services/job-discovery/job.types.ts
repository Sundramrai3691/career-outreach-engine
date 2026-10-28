export type JobSourceName = 'greenhouse' | 'lever' | 'official_careers';

export type JobDiscoveryStatus =
  | 'pending'
  | 'searching'
  | 'matched'
  | 'no_matches'
  | 'partial_results'
  | 'unsupported_source'
  | 'blocked'
  | 'rate_limited'
  | 'provider_failure';

export interface JobBoardConfiguration {
  domain: string;
  provider: 'greenhouse' | 'lever';
  board: string;
}

export interface JobCompanyTarget {
  id: string;
  name: string;
  domain?: string | null;
  careersUrl?: string | null;
}

export interface PublicJobPosting {
  externalId?: string;
  title: string;
  location?: string;
  description?: string;
  jobUrl: string;
  sourceUrl: string;
}

export interface JobSourceProvider {
  readonly name: JobSourceName;
  discover(company: JobCompanyTarget): Promise<PublicJobPosting[]>;
}

export class JobSourceError extends Error {
  constructor(
    message: string,
    readonly kind: 'rate_limited' | 'blocked' | 'unsupported_source' | 'provider_failure'
  ) {
    super(message);
    this.name = 'JobSourceError';
  }
}

export interface JobDiscoveryOutcome {
  status: Exclude<JobDiscoveryStatus, 'pending' | 'searching'>;
  jobsFound: number;
  message: string;
  providersTried: Array<{ provider: JobSourceName; status: string; reason?: string }>;
}

export interface JobSourceCoverageRow {
  companyId: string;
  companyName: string;
  domain?: string | null;
  sources: Array<{
    provider: JobSourceName;
    identifier?: string | null;
    careersUrl?: string | null;
    isValidated: boolean;
    status: string;
    lastSuccessfulScanAt?: Date | null;
    latestError?: string | null;
    lastJobCount: number;
  }>;
}
