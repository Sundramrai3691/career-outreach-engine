import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CredentialResolver } from '../../src/config/credential-resolver.js';
import { encryptSecret } from '../../src/utils/crypto.js';

describe('CredentialResolver Unit Tests', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.APOLLO_API_KEY;
    delete process.env.HUNTER_API_KEY;
    delete process.env.SNOV_CLIENT_ID;
    delete process.env.SNOV_CLIENT_SECRET;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('resolves credentials from environment when no DB override exists', async () => {
    process.env.APOLLO_API_KEY = 'env-apollo-secret-123';

    const mockPrisma: any = {
      providerSetting: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };

    const resolver = new CredentialResolver(mockPrisma);
    const resolved = await resolver.resolve('apollo');

    expect(resolved.isConfigured).toBe(true);
    expect(resolved.source).toBe('environment');
    expect(resolved.apiKey).toBe('env-apollo-secret-123');
  });

  it('blank database override never masks valid environment variable', async () => {
    process.env.APOLLO_API_KEY = 'env-apollo-key-999';

    // DB record with empty or encrypted whitespace key
    const mockPrisma: any = {
      providerSetting: {
        findUnique: vi.fn().mockResolvedValue({
          providerKey: 'apollo',
          encryptedApiKey: encryptSecret('   '),
        }),
      },
    };

    const resolver = new CredentialResolver(mockPrisma);
    const resolved = await resolver.resolve('apollo');

    expect(resolved.isConfigured).toBe(true);
    expect(resolved.source).toBe('environment');
    expect(resolved.apiKey).toBe('env-apollo-key-999');
  });

  it('valid database override takes precedence over environment variable', async () => {
    process.env.HUNTER_API_KEY = 'env-hunter-key';

    const mockPrisma: any = {
      providerSetting: {
        findUnique: vi.fn().mockResolvedValue({
          providerKey: 'hunter',
          encryptedApiKey: encryptSecret('custom-db-hunter-override'),
        }),
      },
    };

    const resolver = new CredentialResolver(mockPrisma);
    const resolved = await resolver.resolve('hunter');

    expect(resolved.isConfigured).toBe(true);
    expect(resolved.source).toBe('database_override');
    expect(resolved.apiKey).toBe('custom-db-hunter-override');
  });

  it('reports missing source when both env and DB overrides are absent', async () => {
    const mockPrisma: any = {
      providerSetting: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };

    const resolver = new CredentialResolver(mockPrisma);
    const resolved = await resolver.resolve('apollo');

    expect(resolved.isConfigured).toBe(false);
    expect(resolved.source).toBe('missing');
    expect(resolved.apiKey).toBe('');
    expect(resolved.missingEnvVar).toBe('APOLLO_API_KEY');
  });

  it('always resolves mock provider as configured', async () => {
    const mockPrisma: any = {
      providerSetting: {
        findUnique: vi.fn(),
      },
    };

    const resolver = new CredentialResolver(mockPrisma);
    const resolved = await resolver.resolve('mock');

    expect(resolved.isConfigured).toBe(true);
    expect(resolved.source).toBe('environment');
    expect(mockPrisma.providerSetting.findUnique).not.toHaveBeenCalled();
  });
});
