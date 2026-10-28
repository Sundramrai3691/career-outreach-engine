import { z } from 'zod';

export const CompanyInputSchema = z.object({
  name: z.string().min(1, 'Company name is required').trim(),
  domain: z.string().optional().nullable().transform((val) => val?.trim() || undefined),
  targetRoles: z.array(z.string().min(1)).min(1, 'At least one target role is required'),
  locations: z.array(z.string().min(1).trim()).optional().default([]),
  location: z.string().optional().nullable().transform((val) => val?.trim() || undefined),
  jobUrl: z.string().url('Invalid job URL').optional().nullable().or(z.literal('')).transform((val) => val?.trim() || undefined),
  notes: z.string().optional().nullable().transform((val) => val?.trim() || undefined),
});

export const BulkCompanyDiscoveryInputSchema = z.object({
  companies: z.array(CompanyInputSchema).min(1, 'At least one company must be supplied'),
  config: z.object({
    maxBudget: z.number().min(0).optional().default(50),
    allowEnrichment: z.boolean().default(false),
    freeFirstMode: z.boolean().default(true),
    verifyEmails: z.boolean().default(true),
    providerPriority: z.array(z.enum(['apollo', 'hunter', 'snov', 'mock', 'tomba', 'official_website'])).optional(),
    jobProfile: z.object({
      targetRoles: z.array(z.string().trim().min(1)).default([]),
      excludedRoles: z.array(z.string().trim().min(1)).default([]),
      technicalSkills: z.array(z.string().trim().min(1)).default([]),
      requiredSkills: z.array(z.string().trim().min(1)).default([]),
      graduationYear: z.number().int().min(2000).max(2100).optional().nullable(),
      eligibleGraduationYearMin: z.number().int().min(2000).max(2100).optional().nullable(),
      eligibleGraduationYearMax: z.number().int().min(2000).max(2100).optional().nullable(),
      experienceLevels: z.array(z.string().trim().min(1)).default([]),
      locations: z.array(z.string().trim().min(1)).default([]),
      remotePreference: z.enum(['any', 'remote_preferred', 'remote_only']).default('any'),
      excludedLocations: z.array(z.string().trim().min(1)).default([]),
    }).optional(),
  }).default({}),
});

export const CandidateProfileSchema = z.object({
  targetRoles: z.array(z.string().trim().min(1)).default([]),
  excludedRoles: z.array(z.string().trim().min(1)).default([]),
  technicalSkills: z.array(z.string().trim().min(1)).default([]),
  requiredSkills: z.array(z.string().trim().min(1)).default([]),
  graduationYear: z.number().int().min(2000).max(2100).optional().nullable(),
  eligibleGraduationYearMin: z.number().int().min(2000).max(2100).optional().nullable(),
  eligibleGraduationYearMax: z.number().int().min(2000).max(2100).optional().nullable(),
  experienceLevels: z.array(z.string().trim().min(1)).default([]),
  locations: z.array(z.string().trim().min(1)).default([]),
  remotePreference: z.enum(['any', 'remote_preferred', 'remote_only']).default('any'),
  excludedLocations: z.array(z.string().trim().min(1)).default([]),
});

export const EmailTemplateSchema = z.object({
  name: z.string().min(1, 'Template name is required').trim(),
  subject: z.string().min(1, 'Email subject is required').trim(),
  bodyText: z.string().min(1, 'Email body is required'),
  signature: z.string().optional().nullable(),
  isDefault: z.boolean().optional().default(false),
});

export const PrepareGoogleMailMergeSchema = z.object({
  campaignName: z.string().min(1, 'Campaign name is required').trim(),
  contactIds: z.array(z.string().uuid()).min(1, 'At least one contact must be selected'),
  templateId: z.string().uuid().optional().nullable(),
  draftSubject: z.string().optional(),
  draftBody: z.string().optional(),
  reuseExistingCampaignId: z.string().uuid().optional().nullable(),
});

export const NativeGmailSendSchema = z.object({
  campaignId: z.string().uuid(),
  recipientIds: z.array(z.string().uuid()).min(1, 'At least one recipient must be selected'),
  dailyCapOverride: z.number().min(1).max(200).optional(),
  isDraftOnly: z.boolean().default(false),
});

export const UpdateProviderSettingSchema = z.object({
  providerKey: z.enum(['apollo', 'hunter', 'snov', 'mock']),
  isEnabled: z.boolean().optional(),
  priority: z.number().min(1).max(10).optional(),
  apiKey: z.string().optional(),
  secret: z.string().optional(),
  spendingCap: z.number().min(0).optional().nullable(),
});

export const SuppressionInputSchema = z.object({
  email: z.string().email(),
  reason: z.enum(['bounced', 'opted_out', 'manual_block']),
  notes: z.string().optional(),
});
