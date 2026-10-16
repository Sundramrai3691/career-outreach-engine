import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Deterministically loads environment variables from root .env and server .env,
 * regardless of shell working directory.
 */
export function loadEnvironment(): void {
  // server directory: .../server
  const serverDir = path.resolve(__dirname, '../..');
  // root directory: .../Referral_Engine
  const rootDir = path.resolve(serverDir, '..');

  const rootEnvPath = path.join(rootDir, '.env');
  const serverEnvPath = path.join(serverDir, '.env');

  // Load root .env first
  if (fs.existsSync(rootEnvPath)) {
    dotenv.config({ path: rootEnvPath });
  }

  // Also load server .env (fills in any missing keys without overriding already set keys)
  if (fs.existsSync(serverEnvPath)) {
    dotenv.config({ path: serverEnvPath });
  }
}

// Automatically load upon import
loadEnvironment();
