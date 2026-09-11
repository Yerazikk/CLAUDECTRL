import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
  },
  resolve: {
    alias: {
      '@claudectrl/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
});
