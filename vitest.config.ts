import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['src/tests/setup.ts'],
    globals: true,
    include: ['src/tests/**/*.{test,spec}.{ts,tsx}', 'scripts/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**', '.opencode/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json', 'html', 'lcov'],
      include: ['src/**'],
      exclude: [
        'src/main.tsx',
        'src/tests/**',
        'src/vite-env.d.ts',
        'src/styles/**',
        'src/types/**',
        'src/**/*.css',
        'src/lib/playwright-ipc-mock.ts',
        'src/lib/monaco-worker-setup.ts',
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        statements: 90,
      },
    },
  },
})
