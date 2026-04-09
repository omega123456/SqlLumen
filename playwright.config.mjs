import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import { defineConfig, devices } from '@playwright/test'
import { DEV_SERVER_HOST } from './scripts/pick-dev-port.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const portFile = path.join(root, '.playwright-dev-port')

// The port file is written by a pre-script (ensure-playwright-port.mjs) that
// runs before both `test:e2e` and `test:screenshots`.  Reading from a file
// (rather than calling pickDevPort at config-evaluation time) is critical
// because Playwright evaluates the config module in EVERY worker process —
// each call to pickDevPort would race and pick a different port than the one
// the webServer is actually bound to.
if (!existsSync(portFile)) {
  throw new Error(
    'Missing .playwright-dev-port. Run Playwright via pnpm test:e2e / pnpm test:screenshots, ' +
      'or first run: node scripts/ensure-playwright-port.mjs'
  )
}

const portText = readFileSync(portFile, 'utf8')
const port = parseInt(portText.trim(), 10)
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid port in .playwright-dev-port: ${portText.trim()}`)
}

const baseURL = `http://${DEV_SERVER_HOST}:${port}`

// One shared Vite dev server cannot serve unbounded parallel Chromium + Monaco; uncapped workers
// overload it (flaky autocomplete + net::ERR_CONNECTION_REFUSED mid-run after test:coverage + rust).
// Keep the default e2e worker cap conservative to avoid the dev server falling over during the
// full `pnpm test:all` gate after the coverage-heavy TypeScript + Rust suites have already run.
// Screenshot-only runs (scripts/playwright-screenshots.mjs) may use more workers; still capped at 10.
const availableCpus = Math.max(1, os.availableParallelism?.() ?? os.cpus().length)
const isCI = !!process.env.CI
const isScreenshotRun = process.env.PLAYWRIGHT_SCREENSHOT_RUN === '1'
const workers = isCI ? 1 : Math.min(isScreenshotRun ? 10 : 2, availableCpus)

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers,
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
      // server stalls suggestions (timeouts, closed pages).
      workers: 1,
      // Autocomplete tests do more setup (connect + editor + type + retry Ctrl+Space).
      // 25s gives enough headroom without the old 60s bloat.
      timeout: 25_000,
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
    // --strictPort: if the probed port was grabbed by a race, Vite fails fast
    // and Playwright surfaces a clear error rather than silently connecting to
    // the wrong server.
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
