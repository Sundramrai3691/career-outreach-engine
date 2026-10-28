/**
 * Core Domain Types for Automated Contact Discovery & Google Mail-Merge
 */

export type EmailVerificationStatus =
  | 'verified'
  | 'valid'
  | 'unverified'
  | 'accept_all'
  | 'unknown'
  | 'invalid'
  | 'unavailable';

export type OutreachState =
  | 'not_contacted'
  | 'selected'
  | 'draft_created'
  | 'queued'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'bounced'
  | 'replied'
  | 'opted_out'
  | 'suppressed';

export type ProviderName = 'tomba' | 'apollo' | 'hunter' | 'snov' | 'mock' | 'official_website' | 'csv_import';

export type DiscoveryItemStatus =
  | 'waiting'
  | 'resolving_company'
  | 'searching_contacts'
  | 'finding_emails'
  | 'verifying'
  | 'completed'
  | 'failed';

export type DiscoveryRunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'completed_with_results'
  | 'completed_no_results'
  | 'completed_jobs_only'
  | 'partially_completed'
  | 'waiting_for_credentials'
  | 'blocked_by_provider'
  | 'failed'
  | 'cancelled';

export interface CompanyTargetInput {
  name: string;
  domain?: string;
  targetRoles: string[];
  locations?: string[];
  location?: string;
  jobUrl?: string;
  notes?: string;
}

export interface DiscoveredPersonProfile {
  id: string; // Internal provider ID if any
  firstName?: string;
  lastName?: string;
  fullName: string;
  jobTitle?: string;
  companyName: string;
  companyDomain?: string;
  matchedRole?: string;
  email?: string;
  emailStatus: EmailVerificationStatus;
  confidenceScore?: number;
  sourceProvider: ProviderName;
  sourceUrl?: string;
  linkedinUrl?: string;
  rawMetadata?: Record<string, any>;
}

export interface ProviderPersonResult {
  providerPersonId: string;
  firstName?: string;
  lastName?: string;
  fullName: string;
  title?: string;
  organizationName?: string;
  organizationDomain?: string;
  linkedinUrl?: string;
  headline?: string;
}

export interface ProviderContactResult {
  email: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  position?: string;
  companyName?: string;
  domain?: string;
  confidence?: number;
  status: EmailVerificationStatus;
  sources?: Array<{ domain: string; uri: string; extractedOn?: string }>;
  raw?: any;
}

export interface ProviderEnrichResult {
  success: boolean;
  email?: string;
  emailStatus?: EmailVerificationStatus;
  confidence?: number;
  linkedinUrl?: string;
  creditsConsumed?: number;
  raw?: any;
}

export interface ProviderEmailResult {
  found: boolean;
  email?: string;
  score?: number;
  status: EmailVerificationStatus;
  sources?: Array<{ domain: string; uri: string }>;
  creditsConsumed?: number;
  raw?: any;
}

export interface ProviderVerificationResult {
  status: EmailVerificationStatus;
  score: number;
  smtpCheck: boolean;
  mxCheck: boolean;
  isCatchAll: boolean;
  isDisposable: boolean;
  raw?: any;
}

export interface ProviderUsageResult {
  planName?: string;
  creditsUsed: number;
  creditsRemaining?: number;
  dailySearchesUsed?: number;
  isUnlimited?: boolean;
}

export type ProviderHealthStatus =
  | 'operational'
  | 'healthy'
  | 'authenticated_restricted'
  | 'account_restricted'
  | 'quota_exhausted'
  | 'rate_limited'
  | 'auth_failed'
  | 'missing_credentials'
  | 'error';

export interface ProviderHealthResult {
  healthy: boolean;
  authenticated?: boolean;
  authConfigured?: boolean;
  canSearch?: boolean;
  provider: ProviderName;
  status?: ProviderHealthStatus;
  message: string;
  authMessage?: string;
  restrictionReason?: string;
  nextAction?: string;
  latencyMs?: number;
  planName?: string;
  availableSearches?: number;
  availableVerifications?: number;
  rateLimits?: {
    rps?: number;
    rpm?: number;
    daily?: number;
    dailyLeft?: number;
    limitRequests?: number;
    remainingRequests?: number;
    resetTime?: number;
  };
}

export interface DiscoveryRunConfig {
  maxBudget?: number;
  allowEnrichment: boolean;
  freeFirstMode: boolean;
  verifyEmails: boolean;
  providerPriority?: ProviderName[];
  includeOfficialWeb?: boolean;
  jobProfile?: import('../services/job-discovery/job-fit.service.js').CandidateProfileInput;
}

export interface TemplateVariables {
  FirstName?: string;
  LastName?: string;
  FullName?: string;
  Company?: string;
  JobTitle?: string;
  Role?: string;
  JobURL?: string;
  [key: string]: string | undefined;
}

export interface RenderedEmail {
  to: string;
  subject: string;
  body: string;
  missingVariables: string[];
}
