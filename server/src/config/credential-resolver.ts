import { PrismaClient } from '@prisma/client';
import { ProviderName } from '../models/types.js';
import { decryptSecret } from '../utils/crypto.js';

export type CredentialSource = 'environment' | 'database_override' | 'missing';

export interface ResolvedProviderCredentials {
  provider: ProviderName;
  apiKey: string;
  secret?: string;
  source: CredentialSource;
  isConfigured: boolean;
  missingEnvVar?: string;
}

export class CredentialResolver {
  constructor(private prisma: PrismaClient) {}

  /**
   * Resolves provider credentials following the documented precedence rule:
   * 1. Valid, non-blank encrypted database override (if set).
   * 2. Environment variable (APOLLO_API_KEY, HUNTER_API_KEY, etc.).
   * Blank database fields NEVER mask a valid environment variable.
   */
  async resolve(provider: ProviderName): Promise<ResolvedProviderCredentials> {
    if (provider === 'mock' || provider === 'official_website' || provider === 'csv_import') {
      return {
        provider,
        apiKey: 'built-in',
        source: 'environment',
        isConfigured: true,
      };
    }

    // 1. Check for database override
    const setting = await this.prisma.providerSetting.findUnique({
      where: { providerKey: provider },
    });

    let dbKey = '';
    let dbSecret = '';

    if (setting?.encryptedApiKey) {
      try {
        const decrypted = decryptSecret(setting.encryptedApiKey).trim();
        if (decrypted.length > 0) {
          dbKey = decrypted;
        }
      } catch {
        // Decryption failure: do not mask environment credentials
      }
    }

    if (setting?.encryptedSecret) {
      try {
        const decrypted = decryptSecret(setting.encryptedSecret).trim();
        if (decrypted.length > 0) {
          dbSecret = decrypted;
        }
      } catch {
        // Decryption failure: do not mask environment credentials
      }
    }

    // If a valid non-empty DB override was found, it takes precedence
    if (dbKey.length > 0) {
      return {
        provider,
        apiKey: dbKey,
        secret: dbSecret || undefined,
        source: 'database_override',
        isConfigured: true,
      };
    }

    // 2. Check corresponding environment variables
    let envKey = '';
    let envSecret = '';
    let expectedVarName = '';

    if (provider === 'apollo') {
      expectedVarName = 'APOLLO_API_KEY';
      envKey = process.env.APOLLO_API_KEY?.trim() || '';
    } else if (provider === 'hunter') {
      expectedVarName = 'HUNTER_API_KEY';
      envKey = process.env.HUNTER_API_KEY?.trim() || '';
    } else if (provider === 'snov') {
      expectedVarName = 'SNOV_CLIENT_ID';
      envKey = process.env.SNOV_CLIENT_ID?.trim() || '';
      envSecret = process.env.SNOV_CLIENT_SECRET?.trim() || '';
    }

    if (envKey.length > 0) {
      return {
        provider,
        apiKey: envKey,
        secret: envSecret || undefined,
        source: 'environment',
        isConfigured: true,
      };
    }

    // 3. Credential missing
    return {
      provider,
      apiKey: '',
      secret: undefined,
      source: 'missing',
      isConfigured: false,
      missingEnvVar: expectedVarName,
    };
  }
}
