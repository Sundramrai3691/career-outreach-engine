import dns from 'node:dns/promises';
import { EmailVerificationStatus } from '../../models/types.js';
import { NormalizerService } from '../normalizer.service.js';
import { HunterProvider } from '../../providers/hunter/hunter.provider.js';
import { logger } from '../../utils/logger.js';

export interface VerificationOutcome {
  status: EmailVerificationStatus;
  score: number;
  isMxValid: boolean;
  isSmtpValid?: boolean;
  isCatchAll?: boolean;
  isDisposable?: boolean;
  details: string;
}

export class EmailVerificationService {
  constructor(private hunterProvider?: HunterProvider) {}

  /**
   * Multi-stage verification pipeline
   */
  async verifyEmail(email: string, useExternalProvider = false): Promise<VerificationOutcome> {
    const normalized = NormalizerService.normalizeEmail(email);

    // Stage 1: Syntax & RFC 5322 Check
    if (!NormalizerService.isValidEmailFormat(normalized)) {
      return {
        status: 'invalid',
        score: 0,
        isMxValid: false,
        details: 'Failed email syntax format validation (RFC 5322).',
      };
    }

    const domain = normalized.split('@')[1];

    // Stage 2: DNS MX Record check
    let hasMx = false;
    try {
      const mxRecords = await dns.resolveMx(domain);
      if (mxRecords && mxRecords.length > 0) {
        hasMx = true;
      }
    } catch (err: any) {
      logger.debug(`DNS MX lookup failed for ${domain}: ${err.message}`);
      // If no MX, check if fallback A record exists
      try {
        const aRecords = await dns.resolve4(domain);
        if (aRecords && aRecords.length > 0) {
          hasMx = true;
        }
      } catch {
        return {
          status: 'invalid',
          score: 10,
          isMxValid: false,
          details: 'Domain has no valid MX or mail routing records.',
        };
      }
    }

    // Stage 3: External provider verification if enabled
    if (useExternalProvider && this.hunterProvider) {
      try {
        const result = await this.hunterProvider.verifyEmail(normalized);
        return {
          status: result.status,
          score: result.score,
          isMxValid: result.mxCheck,
          isSmtpValid: result.smtpCheck,
          isCatchAll: result.isCatchAll,
          isDisposable: result.isDisposable,
          details: `Verified via Hunter (SMTP Check: ${result.smtpCheck ? 'Passed' : 'Failed'}).`,
        };
      } catch (err) {
        logger.warn('External email verification provider failed, using DNS result', err);
      }
    }

    // Default DNS-backed result
    return {
      status: 'unverified',
      score: 70,
      isMxValid: hasMx,
      details: 'Domain has active mail exchange (MX) records. SMTP mailbox unverified.',
    };
  }
}
