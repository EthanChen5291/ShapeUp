import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@convex': path.resolve(__dirname, 'convex'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'convex/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.{ts,tsx}', 'convex/**/*.ts'],
      exclude: [
        'convex/_generated/**',
        'src/**/*.d.ts',
        'src/app/**/*.test.{ts,tsx}',
        'src/components/**/*.test.{ts,tsx}',
      ],
    },
  },
});
