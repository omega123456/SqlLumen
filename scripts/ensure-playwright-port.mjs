/**
 * Pre-script: probe for a free port and write it to .playwright-dev-port.
 *
 * This MUST run before Playwright evaluates its config because Playwright
 * loads the config module in every worker process.  If the port were chosen
 * dynamically inside the config (via top-level await), each worker would
 * race and pick a different port than the one the webServer is bound to.
 *
 * Called automatically by `pnpm test:e2e` and `pnpm test:screenshots` via
 * `&&` chaining in the respective package.json scripts.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { pickDevPort, DEV_SERVER_HOST } from './pick-dev-port.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const portFile = path.join(root, '.playwright-dev-port')

const port = await pickDevPort(DEV_SERVER_HOST)
writeFileSync(portFile, `${port}\n`, 'utf8')
console.log(`Wrote port ${port} to .playwright-dev-port`)
