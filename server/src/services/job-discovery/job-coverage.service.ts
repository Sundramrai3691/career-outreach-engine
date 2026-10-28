export interface SourceCoverageCompany {
  companyId: string;
  companyName: string;
  domain?: string | null;
  sources: Array<{
    provider: string;
    identifier?: string | null;
    careersUrl?: string | null;
    isValidated: boolean;
    status: string;
    lastSuccessfulScanAt?: Date | null;
    latestError?: string | null;
    lastJobCount: number;
  }>;
}

export function summarizeJobSourceCoverage<T extends SourceCoverageCompany>(companies: T[]) {
  const totalCompanies = companies.length;
  const validatedMonitorable = companies.filter((row) => row.sources.some((source) => source.isValidated)).length;
  const successfullyScanned = companies.filter((row) => row.sources.some((source) => source.lastSuccessfulScanAt)).length;
  const zeroJobsAfterSuccessfulScan = companies.filter((row) => {
    const successful = row.sources.filter((source) => source.lastSuccessfulScanAt);
    return successful.length > 0 && successful.every((source) => source.lastJobCount === 0);
  }).length;
  const unsupportedOrUnconfigured = companies.filter((row) => row.sources.length === 0 ||
    row.sources.every((source) => ['unsupported_source', 'unconfigured'].includes(source.status))).length;
  const failing = companies.filter((row) => row.sources.some((source) =>
    ['provider_failure', 'rate_limited', 'blocked'].includes(source.status))).length;

  return {
    totalCompanies,
    validatedMonitorable,
    successfullyScanned,
    zeroJobsAfterSuccessfulScan,
    unsupportedOrUnconfigured,
    failing,
    coveragePercent: totalCompanies ? Math.round(validatedMonitorable / totalCompanies * 10000) / 100 : 0,
    coverageDenominator: totalCompanies,
  };
}
