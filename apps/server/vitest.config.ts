import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    server: {
      deps: {
        external: ['better-sqlite3'],
      },
    },
  },
  resolve: {
    alias: {
      '@claudectrl/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
});
