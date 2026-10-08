// evlog settings shared by instrumentation.ts and lib/log.ts. No Node-only imports: instrumentation.ts loads this.
import type { RedactConfig } from 'evlog';

export const service = 'factory';

/**
 * Defense in depth, in every environment: no credential goes into an event on purpose, but errors and captured library
 * output could carry one. The PII builtins (email, phone, card, IP) stay off: the factory handles no such data, and the
 * card pattern masks any numeric ID that happens to pass its checksum.
 */
export const redact: RedactConfig = {
  builtins: ['jwt', 'bearer'],
  patterns: [
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, // GitHub tokens
    /\bvck_[A-Za-z0-9]{20,}\b/g, // AI Gateway keys
    /\bBasic [A-Za-z0-9+/=]{16,}/g, // git over HTTPS (x-access-token)
  ],
  paths: ['headers', 'authorization', 'token', '*token', '*Token', 'apiKey', 'password', '*secret', 'bypass'],
  replacement: '[redacted]',
};
