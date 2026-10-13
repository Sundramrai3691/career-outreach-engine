import { PrismaClient } from '@prisma/client';
import { NormalizerService } from './normalizer.service.js';

export class SuppressionService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Checks if an email is in the suppression list
   */
  async isSuppressed(email: string): Promise<{ suppressed: boolean; reason?: string }> {
    const normalized = NormalizerService.normalizeEmail(email);
    if (!normalized) return { suppressed: true, reason: 'invalid_email' };

    const record = await this.prisma.suppression.findUnique({
      where: { email: normalized },
    });

    if (record) {
      return { suppressed: true, reason: record.reason };
    }

    // Also check if any existing contact record for this email has bounced or opted out
    const contact = await this.prisma.contact.findUnique({
      where: { email: normalized },
    });

    if (contact && (contact.outreachState === 'bounced' || contact.outreachState === 'opted_out')) {
      return { suppressed: true, reason: contact.outreachState };
    }

    return { suppressed: false };
  }

  /**
   * Adds an email to the suppression table
   */
  async suppressEmail(email: string, reason: 'bounced' | 'opted_out' | 'manual_block', notes?: string): Promise<void> {
    const normalized = NormalizerService.normalizeEmail(email);
    if (!normalized) return;

    await this.prisma.suppression.upsert({
      where: { email: normalized },
      update: { reason, notes, createdAt: new Date() },
      create: { email: normalized, reason, notes },
    });

    // Update any contact record with this email
    await this.prisma.contact.updateMany({
      where: { email: normalized },
      data: {
        outreachState: reason === 'bounced' ? 'bounced' : 'opted_out',
        emailStatus: reason === 'bounced' ? 'invalid' : undefined,
      },
    });
  }

  /**
   * Returns all suppressed emails
   */
  async getAllSuppressed() {
    return this.prisma.suppression.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }
}
