import { PrismaClient } from '@prisma/client';
import { parse } from 'csv-parse/sync';
import { NormalizerService } from '../normalizer.service.js';
import { EmailVerificationStatus } from '../../models/types.js';

export interface CsvImportRow {
  company?: string;
  companyName?: string;
  role?: string;
  jobTitle?: string;
  title?: string;
  name?: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  emailAddress?: string;
  source?: string;
  sourceProvider?: string;
  verificationStatus?: string;
  status?: string;
  linkedinUrl?: string;
  notes?: string;
  [key: string]: string | undefined;
}

export interface CsvImportResult {
  success: boolean;
  totalRows: number;
  importedCount: number;
  updatedCount: number;
  skippedCount: number;
  summary: {
    totalRows: number;
    imported: number;
    updated: number;
    skippedSuppressed: number;
    errors: number;
  };
  contacts: any[];
  errors: Array<{ row: number; error: string }>;
}

export class ContactImportService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Imports contacts from CSV text, validates, deduplicates by email,
   * preserves source provenance, and links to target companies.
   */
  async importCsv(csvContent: string, fileName = 'manual_upload.csv'): Promise<CsvImportResult> {
    if (!csvContent || !csvContent.trim()) {
      throw new Error('CSV content is empty.');
    }

    let records: Record<string, string>[];
    try {
      records = parse(csvContent, {
        columns: (header: string[]) =>
          header.map((col) => col.trim().toLowerCase().replace(/[\s_-]+/g, '')),
        skip_empty_lines: true,
        trim: true,
      });
    } catch (err: any) {
      throw new Error(`Failed to parse CSV: ${err.message}`);
    }

    if (!records || records.length === 0) {
      throw new Error('No valid records found in CSV file.');
    }

    let importedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const errors: Array<{ row: number; error: string }> = [];
    const savedContacts: any[] = [];

    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const rowNumber = i + 2; // header is row 1

      // Flexible column extraction
      const rawEmail =
        row.email ||
        row.emailaddress ||
        row.workemail ||
        row.contactemail ||
        '';

      const normalizedEmail = NormalizerService.normalizeEmail(rawEmail);
      if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        skippedCount++;
        errors.push({ row: rowNumber, error: `Invalid or missing email address: "${rawEmail}"` });
        continue;
      }

      const rawCompany =
        row.company ||
        row.companyname ||
        row.organization ||
        row.employer ||
        normalizedEmail.split('@')[1]?.split('.')[0] ||
        'Unknown Company';

      const cleanCompany = NormalizerService.normalizeCompanyName(rawCompany);
      const emailDomain = normalizedEmail.split('@')[1];

      const rawRole =
        row.role ||
        row.jobtitle ||
        row.title ||
        row.position ||
        'Professional Contact';

      const rawName =
        row.name ||
        row.fullname ||
        (row.firstname && row.lastname ? `${row.firstname} ${row.lastname}` : '') ||
        row.firstname ||
        row.lastname ||
        normalizedEmail.split('@')[0].replace(/[._-]/g, ' ') ||
        'Contact';

      let firstName = row.firstname || '';
      let lastName = row.lastname || '';
      if (!firstName && rawName) {
        const parts = rawName.trim().split(/\s+/);
        firstName = parts[0] || '';
        lastName = parts.slice(1).join(' ') || '';
      }

      const rawSource =
        row.source ||
        row.sourceprovider ||
        row.primarysource ||
        'csv_import';

      const rawStatus = (
        row.verificationstatus ||
        row.status ||
        row.emailstatus ||
        'unverified'
      ).toLowerCase();

      let validStatus: EmailVerificationStatus = 'unverified';
      if (rawStatus.includes('valid') || rawStatus === 'verified') validStatus = 'verified';
      else if (rawStatus.includes('accept') || rawStatus === 'accept_all') validStatus = 'accept_all';
      else if (rawStatus.includes('invalid')) validStatus = 'invalid';
      else if (rawStatus === 'unknown') validStatus = 'unknown';

      const linkedinUrl = row.linkedin || row.linkedinurl || undefined;
      const notes = row.notes || undefined;

      try {
        // 1. Link or create company
        let companyRecord = null;
        if (cleanCompany) {
          const domain = NormalizerService.normalizeDomain(emailDomain);
          companyRecord = await this.prisma.company.upsert({
            where: domain ? { domain } : { id: 'placeholder-company-id' },
            update: { name: cleanCompany },
            create: {
              name: cleanCompany,
              domain,
              normalizedDomain: domain,
            },
          });
        }

        // 2. Check existing contact for deduplication
        const existing = await this.prisma.contact.findUnique({
          where: { email: normalizedEmail },
        });

        const contact = await this.prisma.contact.upsert({
          where: { email: normalizedEmail },
          update: {
            fullName: rawName,
            firstName: firstName || undefined,
            lastName: lastName || undefined,
            jobTitle: rawRole || undefined,
            companyName: cleanCompany,
            companyId: companyRecord?.id || undefined,
            companyDomain: emailDomain,
            matchedRole: rawRole,
            primarySource: rawSource,
            emailStatus: validStatus,
            confidenceScore: validStatus === 'verified' ? 95 : 85,
            notes: notes || undefined,
          },
          create: {
            email: normalizedEmail,
            fullName: rawName,
            firstName,
            lastName,
            jobTitle: rawRole,
            companyName: cleanCompany,
            companyId: companyRecord?.id,
            companyDomain: emailDomain,
            matchedRole: rawRole,
            primarySource: rawSource,
            emailStatus: validStatus,
            confidenceScore: validStatus === 'verified' ? 95 : 85,
            notes,
          },
        });

        if (existing) {
          updatedCount++;
        } else {
          importedCount++;
        }

        // 3. Preserve provenance in ContactSource
        await this.prisma.contactSource.create({
          data: {
            contactId: contact.id,
            provider: rawSource,
            rawTitle: rawRole,
            rawEmail: normalizedEmail,
            sourceUrl: linkedinUrl || `csv://${fileName}#row=${rowNumber}`,
            confidence: validStatus === 'verified' ? 95 : 85,
            metadataJson: JSON.stringify({
              importedAt: new Date().toISOString(),
              file: fileName,
              rowNumber,
              originalFields: row,
            }),
          },
        });

        // 4. Save email verification record
        await this.prisma.emailVerification.create({
          data: {
            contactId: contact.id,
            provider: rawSource,
            status: validStatus,
            score: validStatus === 'verified' ? 95 : 80,
            rawResponseJson: JSON.stringify({ source: 'csv_import', originalStatus: rawStatus }),
          },
        });

        savedContacts.push(contact);
      } catch (err: any) {
        skippedCount++;
        errors.push({ row: rowNumber, error: `Database error: ${err.message}` });
      }
    }

    return {
      success: savedContacts.length > 0,
      totalRows: records.length,
      importedCount,
      updatedCount,
      skippedCount,
      summary: {
        totalRows: records.length,
        imported: importedCount,
        updated: updatedCount,
        skippedSuppressed: skippedCount,
        errors: errors.length,
      },
      contacts: savedContacts,
      errors,
    };
  }
}
