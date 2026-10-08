import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: {
    include: ['core/**/*.test.ts', 'proofs/**/*.test.ts'],
    env: { FACTORY_OWNER: 'acme', FACTORY_REPO: 'app', FACTORY_ALLOWED_USERS: 'alice' },
  },
});
