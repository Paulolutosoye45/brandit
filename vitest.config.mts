import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  // "@/" is how the app's own files import each other (see tsconfig.json), so tests can load route handlers too.
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  // Components are written in JSX; a test that renders one (the team's words, for example) needs it compiled the way Next does.
  oxc: { jsx: { runtime: 'automatic' } },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 60000, hookTimeout: 60000 },
});
