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

  describe('Tomba Credential Resolution', () => {
    beforeEach(() => {
      delete process.env.TOMBA_API_KEY;
      delete process.env.TOMBA_SECRET_KEY;
      delete process.env.TOMBA_API_SECRET;
    });

    it('resolves TOMBA_API_KEY and TOMBA_SECRET_KEY from environment', async () => {
      process.env.TOMBA_API_KEY = 'ta_test_key_123';
      process.env.TOMBA_SECRET_KEY = 'ts_test_secret_456';

      const mockPrisma: any = {
        providerSetting: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
      };

      const resolver = new CredentialResolver(mockPrisma);
      const resolved = await resolver.resolve('tomba');

      expect(resolved.isConfigured).toBe(true);
      expect(resolved.source).toBe('environment');
      expect(resolved.apiKey).toBe('ta_test_key_123');
      expect(resolved.secret).toBe('ts_test_secret_456');
    });

    it('supports TOMBA_API_SECRET as backward-compatible alias for TOMBA_SECRET_KEY', async () => {
      process.env.TOMBA_API_KEY = 'ta_test_key_123';
      process.env.TOMBA_API_SECRET = 'ts_test_secret_alias';

      const mockPrisma: any = {
        providerSetting: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
      };

      const resolver = new CredentialResolver(mockPrisma);
      const resolved = await resolver.resolve('tomba');

      expect(resolved.isConfigured).toBe(true);
      expect(resolved.secret).toBe('ts_test_secret_alias');
    });

    it('throws error when TOMBA_SECRET_KEY and TOMBA_API_SECRET have conflicting values', async () => {
      process.env.TOMBA_API_KEY = 'ta_test_key_123';
      process.env.TOMBA_SECRET_KEY = 'secret_one';
      process.env.TOMBA_API_SECRET = 'secret_two';

      const mockPrisma: any = {
        providerSetting: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
      };

      const resolver = new CredentialResolver(mockPrisma);
      await expect(resolver.resolve('tomba')).rejects.toThrow(
        /Conflicting values for TOMBA_SECRET_KEY and alias TOMBA_API_SECRET/
      );
    });

    it('allows identical TOMBA_SECRET_KEY and TOMBA_API_SECRET', async () => {
      process.env.TOMBA_API_KEY = 'ta_test_key_123';
      process.env.TOMBA_SECRET_KEY = 'same_secret';
      process.env.TOMBA_API_SECRET = 'same_secret';

      const mockPrisma: any = {
        providerSetting: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
      };

      const resolver = new CredentialResolver(mockPrisma);
      const resolved = await resolver.resolve('tomba');
      expect(resolved.isConfigured).toBe(true);
      expect(resolved.secret).toBe('same_secret');
    });

    it('reports missing when Tomba credentials are absent', async () => {
      const mockPrisma: any = {
        providerSetting: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
      };

      const resolver = new CredentialResolver(mockPrisma);
      const resolved = await resolver.resolve('tomba');

      expect(resolved.isConfigured).toBe(false);
      expect(resolved.source).toBe('missing');
      expect(resolved.missingEnvVar).toBe('TOMBA_API_KEY & TOMBA_SECRET_KEY');
    });
  });
});
