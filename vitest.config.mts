import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/helpers/i18nSetup.ts'],
    coverage: {
      all: true,
      include: ['src/**/*.{ts,tsx}'],
      provider: 'v8',
      thresholds: {
        lines: 90,
        functions: 92,
        branches: 78,
        statements: 90,
      },
    },
  },
});
