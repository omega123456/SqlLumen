import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'line',
  expect: {
    toHaveScreenshot: {
      maxDiffPixels: 900,
      threshold: 0.25,
    },
  },
  use: {
    baseURL: 'http://127.0.0.1:1420',
    trace: 'on-first-retry',
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm --silent dev --host 127.0.0.1 --logLevel error',
    url: 'http://127.0.0.1:1420',
    timeout: 120_000,
    reuseExistingServer: false, // Always start fresh to ensure VITE_PLAYWRIGHT=true
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      VITE_PLAYWRIGHT: 'true',
    },
  },
})
