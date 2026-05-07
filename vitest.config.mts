import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
    coverage: {
      all: true,
      include: ['src/**/*.{ts,tsx}'],
      provider: 'v8',
    },
  },
});
