import path from 'node:path';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  define: { __BUILD_SHA__: JSON.stringify('test') },
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: { environment: 'jsdom', setupFiles: ['./vitest.setup.ts'] },
});
