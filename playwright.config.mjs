import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import { defineConfig, devices } from '@playwright/test'
import { DEV_SERVER_HOST } from './scripts/pick-dev-port.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const portFile = path.join(root, '.playwright-dev-port')

if (!existsSync(portFile)) {
  throw new Error(
    'Missing .playwright-dev-port. Run Playwright via pnpm test:e2e / pnpm test:screenshots, or first run: node scripts/ensure-playwright-port.mjs'
  )
}

const port = parseInt(readFileSync(portFile, 'utf8').trim(), 10)
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid port in .playwright-dev-port: ${readFileSync(portFile, 'utf8')}`)
}

const baseURL = `http://${DEV_SERVER_HOST}:${port}`

// One shared Vite dev server cannot serve unbounded parallel Chromium + Monaco; uncapped workers
// overload it (flaky autocomplete + net::ERR_CONNECTION_REFUSED mid-run after test:coverage + rust).
const localWorkers = Math.min(4, Math.max(1, os.availableParallelism?.() ?? os.cpus().length))
// Screenshot-only runs (scripts/playwright-screenshots.mjs) may use more workers; still capped at 10.
const screenshotWorkers = Math.min(10, Math.max(1, os.availableParallelism?.() ?? os.cpus().length))

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI
    ? 1
    : process.env.PLAYWRIGHT_SCREENSHOT_RUN === '1'
      ? screenshotWorkers
      : localWorkers,
  reporter: 'line',
  timeout: 15_000,
  expect: {
    toHaveScreenshot: {
      maxDiffPixels: 900,
      threshold: 0.25,
    },
  },
  use: {
    baseURL,
    trace: 'on-first-retry',
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    // Monaco + shared Vite: run autocomplete in isolation first so other workers cannot
    // starve the dev server while Ctrl+Space suggestions are opening (flaky .suggest-widget).
    {
      name: 'monaco-autocomplete',
      testMatch: '**/query-autocomplete.spec.ts',
      // Must be single-worker: multiple Chromium instances + Monaco against one Vite dev
      // server stalls suggestions (60s timeouts, closed pages).
      workers: 1,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium',
      testIgnore: '**/query-autocomplete.spec.ts',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['monaco-autocomplete'],
    },
  ],
  webServer: {
    command: `pnpm --silent exec vite --host ${DEV_SERVER_HOST} --port ${port} --strictPort --logLevel error`,
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: false, // Always start fresh to ensure VITE_PLAYWRIGHT=true
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      VITE_PLAYWRIGHT: 'true',
    },
  },
})
