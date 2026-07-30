import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import { defineConfig, devices } from '@playwright/test'
import { DEV_SERVER_HOST } from './scripts/pick-dev-port.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const portFile = path.join(root, '.playwright-dev-port')

// The port file is written by a pre-script (ensure-playwright-port.mjs) before
// `test:e2e`; screenshot runs pass PLAYWRIGHT_DEV_PORT directly. Reading from a file
// (rather than calling pickDevPort at config-evaluation time) is critical
// because Playwright evaluates the config module in EVERY worker process —
// each call to pickDevPort would race and pick a different port than the one
// the webServer is actually bound to.
const portText =
  process.env.PLAYWRIGHT_DEV_PORT ?? (existsSync(portFile) ? readFileSync(portFile, 'utf8') : null)

if (portText === null) {
  throw new Error(
    'Missing .playwright-dev-port. Run Playwright via pnpm test:e2e / pnpm test:screenshots, ' +
      'set PLAYWRIGHT_DEV_PORT, or first run: node scripts/ensure-playwright-port.mjs'
  )
}

const port = parseInt(portText.trim(), 10)
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid Playwright dev server port: ${portText.trim()}`)
}

const baseURL = `http://${DEV_SERVER_HOST}:${port}`

const availableCpus = Math.max(1, os.availableParallelism?.() ?? os.cpus().length)
const isCI = !!process.env.CI
const workers = Math.min(isCI ? 2 : 4, availableCpus)

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers,
  reporter: 'list',
  timeout: 2_000,
  expect: {
    toHaveScreenshot: {
      maxDiffPixels: 50,
      maxDiffPixelRatio: 0.05,
      threshold: 0.2,
    },
  },
  use: {
    baseURL,
    trace: 'on-first-retry',
    viewport: { width: 1280, height: 720 },
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  projects: [
    // Monaco + shared Vite: run autocomplete in isolation first so other workers cannot
    // starve the dev server while Ctrl+Space suggestions are opening (flaky .suggest-widget).
    {
      name: 'monaco-autocomplete',
      testMatch: '**/query-autocomplete.spec.ts',
      // Keep autocomplete serial: multiple Chromium instances still contend on Monaco startup.
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
    // --strictPort: if the probed port was grabbed by a race, Vite fails fast
    // and Playwright surfaces a clear error rather than silently connecting to
    // the wrong server.
    command: `pnpm --silent exec vite preview --host ${DEV_SERVER_HOST} --port ${port} --strictPort --logLevel error`,
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      VITE_PLAYWRIGHT: 'true',
    },
  },
})
