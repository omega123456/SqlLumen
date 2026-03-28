import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { pickDevPort, DEV_SERVER_HOST } from './pick-dev-port.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const mergePath = path.join(projectRoot, 'src-tauri', 'tauri.dev.merge.json')

/**
 * @param {string} url
 * @param {number} timeoutMs
 * @param {number} intervalMs
 */
async function waitForHttp(url, timeoutMs, intervalMs) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url)
      if (r.ok || r.status === 304) {
        return
      }
    } catch {
      // server not ready yet
    }
    await new Promise((r) => {
      setTimeout(r, intervalMs)
    })
  }
  throw new Error(`Timeout waiting for dev server at ${url}`)
}

/**
 * @param {string[]} extraTauriArgs
 * @returns {Promise<number>}
 */
export async function runTauriDev(extraTauriArgs = []) {
  const port = await pickDevPort(DEV_SERVER_HOST)
  const devUrl = `http://${DEV_SERVER_HOST}:${port}`

  let viteShuttingDown = false

  const viteChild = spawn(
    'pnpm',
    ['exec', 'vite', '--port', String(port), '--host', DEV_SERVER_HOST, '--strictPort'],
    {
      cwd: projectRoot,
      stdio: 'inherit',
      shell: true,
    },
  )

  viteChild.on('exit', (code) => {
    if (!viteShuttingDown && code !== 0 && code !== null) {
      console.error(`Vite exited unexpectedly with code ${code}`)
      process.exit(code ?? 1)
    }
  })

  await waitForHttp(devUrl, 120_000, 200)

  const merge = {
    build: {
      devUrl,
      beforeDevCommand: null,
    },
  }
  writeFileSync(mergePath, `${JSON.stringify(merge, null, 2)}\n`, 'utf8')

  const tauriChild = spawn(
    'pnpm',
    ['exec', 'tauri', 'dev', '--config', mergePath, ...extraTauriArgs],
    {
      cwd: projectRoot,
      stdio: 'inherit',
      shell: true,
    },
  )

  const killVite = () => {
    viteShuttingDown = true
    if (!viteChild.killed) {
      viteChild.kill('SIGTERM')
    }
  }

  const onSignal = () => {
    killVite()
    if (!tauriChild.killed) {
      tauriChild.kill('SIGTERM')
    }
  }

  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)

  const exitCode = await new Promise((resolve, reject) => {
    tauriChild.on('error', reject)
    tauriChild.on('exit', (code) => {
      resolve(code ?? 0)
    })
  })

  killVite()
  process.off('SIGINT', onSignal)
  process.off('SIGTERM', onSignal)

  return exitCode
}
