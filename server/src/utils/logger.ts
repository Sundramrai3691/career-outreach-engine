/**
 * Structured logger with automatic scrubbing of sensitive keys and tokens
 */

const SENSITIVE_PATTERNS = [
  /api[-_]?key["']?\s*[:=]\s*["']?([^"',\s]+)/gi,
  /bearer\s+([a-zA-Z0-9_\-\.]+)/gi,
  /secret["']?\s*[:=]\s*["']?([^"',\s]+)/gi,
  /refresh[-_]?token["']?\s*[:=]\s*["']?([^"',\s]+)/gi,
  /access[-_]?token["']?\s*[:=]\s*["']?([^"',\s]+)/gi,
];

function sanitize(msg: string): string {
  let clean = msg;
  for (const pattern of SENSITIVE_PATTERNS) {
    clean = clean.replace(pattern, (match, p1) => {
      const redacted = p1 ? p1.slice(0, 4) + '***' : '***';
      return match.replace(p1, redacted);
    });
  }
  return clean;
}

export const logger = {
  info: (message: string, meta?: any) => {
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    console.log(`[INFO] ${new Date().toISOString()} - ${sanitize(message + metaStr)}`);
  },
  warn: (message: string, meta?: any) => {
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    console.warn(`[WARN] ${new Date().toISOString()} - ${sanitize(message + metaStr)}`);
  },
  error: (message: string, meta?: any) => {
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    console.error(`[ERROR] ${new Date().toISOString()} - ${sanitize(message + metaStr)}`);
  },
  debug: (message: string, meta?: any) => {
    if (process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development') {
      const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
      console.log(`[DEBUG] ${new Date().toISOString()} - ${sanitize(message + metaStr)}`);
    }
  },
};
