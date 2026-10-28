import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const require = createRequire(import.meta.url);
const prismaCli = require.resolve('prisma/build/index.js');
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Creates a fresh SQLite database for an integration test; never uses DATABASE_URL. */
export async function createIsolatedPrisma(): Promise<{ prisma: PrismaClient; cleanup: () => Promise<void> }> {
  const directory = mkdtempSync(path.join(serverRoot, 'tests', '.tmp-referral-engine-test-'));
  const absoluteDirectory = path.resolve(directory);
  const databasePath = path.join(absoluteDirectory, 'integration.db');
  const databaseUrl = `file:${databasePath.replace(/\\/g, '/')}`;

  let prisma: PrismaClient | undefined;
  try {
    const schemaPath = path.join(serverRoot, 'prisma', 'schema.prisma');
    const schemaSql = execFileSync(process.execPath, [prismaCli, 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', schemaPath, '--script'], {
      cwd: serverRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    for (const statement of schemaSql.split(';').map((part) => part.trim()).filter(Boolean)) {
      await prisma.$executeRawUnsafe(statement);
    }
  } catch (error: any) {
    await prisma?.$disconnect();
    const resolved = path.resolve(directory);
    const testRoot = path.resolve(serverRoot, 'tests') + path.sep;
    if (resolved.startsWith(testRoot) && path.basename(resolved).startsWith('.tmp-referral-engine-test-')) {
      rmSync(resolved, { recursive: true, force: true });
    }
    throw new Error(`${error.stdout?.toString() || ''}${error.stderr?.toString() || error.message}`);
  }

  if (!prisma) throw new Error('Isolated Prisma client did not initialize.');
  return {
    prisma,
    cleanup: async () => {
      await prisma.$disconnect();
      const resolved = path.resolve(directory);
      const testRoot = path.resolve(serverRoot, 'tests') + path.sep;
      if (!resolved.startsWith(testRoot) || !path.basename(resolved).startsWith('.tmp-referral-engine-test-')) {
        throw new Error('Refusing to remove a database outside the isolated test temp directory.');
      }
      rmSync(resolved, { recursive: true, force: true });
    },
  };
}
