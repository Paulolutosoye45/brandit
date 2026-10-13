import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  // "@/" is how the app's own files import each other (see tsconfig.json), so tests can load route handlers too.
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 60000, hookTimeout: 60000 },
});
