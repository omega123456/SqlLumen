import { spawn } from 'node:child_process'
import { writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { DEV_SERVER_HOST, PREFERRED_DEV_PORT } from './pick-dev-port.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const mergePath = path.join(projectRoot, 'src-tauri', 'tauri.dev.merge.json')

/** Strip ANSI colour/reset escape sequences so regexes see plain text. */
const ANSI_RE = /\x1b\[[0-9;]*m/g

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
 * Forward all output from `child` to the terminal, and resolve with the
 * actual port Vite announces in its startup banner.
 *
 * Strategy: accumulate ANSI-stripped output and look for the first URL on a
 * "Local:" line, then parse it with `URL` to extract the port.  This handles:
 *   - Vite 4 ("> Local:") and Vite 5 ("➜  Local:") prefixes
 *   - ANSI colour codes wrapping the URL
 *   - Hostnames other than "127.0.0.1" (e.g. "localhost")
 *   - Output split across multiple stream chunks
 *
 * @param {import('node:child_process').ChildProcess} child
 * @param {number} timeoutMs
 * @returns {Promise<number>}
 */
function detectVitePort(child, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    let settled = false
    let buf = ''

    /** Call exactly once; subsequent calls are no-ops. */
    const settle = (fn) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }

    const timer = setTimeout(
      () => settle(() => reject(new Error('Vite did not announce its port within 30 s'))),
      timeoutMs
    )

    /** Forward `chunk` to `writeTo`, then try to extract the Vite port. */
    const tryParse = (chunk, writeTo) => {
      writeTo.write(chunk)
      if (settled) return
      // Accumulate stripped text — stripping before buffering keeps the
      // buffer small and the regex simple.
      buf += chunk.toString().replace(ANSI_RE, '')
      // Vite 4: "> Local:    http://127.0.0.1:1420/"
      // Vite 5: "➜  Local:   http://127.0.0.1:1420/"
      // The `.*?` skips any residual non-ANSI noise between the label and URL.
      const m = buf.match(/Local:.*?(https?:\/\/\S+)/)
      if (!m) return
      try {
        const url = new URL(m[1])
        const p = Number(url.port)
        if (Number.isFinite(p) && p > 0) settle(() => resolve(p))
      } catch {
        // Malformed URL — keep accumulating; more output may complete the line.
      }
    }

    child.stdout?.on('data', (chunk) => tryParse(chunk, process.stdout))
    child.stderr?.on('data', (chunk) => tryParse(chunk, process.stderr))

    // If Vite exits before printing the port banner, reject immediately so
    // the caller gets a useful error rather than waiting for the timeout.
    child.once('exit', (code) => {
      settle(() => reject(new Error(`Vite exited (code ${code}) before announcing its port`)))
    })
  })
}

/**
 * @param {string[]} extraTauriArgs
 * @returns {Promise<number>}
 */
export async function runTauriDev(extraTauriArgs = []) {
  // Remove any stale merge file from a previous run; ignore missing file,
  // but rethrow real filesystem errors (permissions, etc.).
  rmSync(mergePath, { force: true })

  let viteShuttingDown = false
  // Becomes true once Vite is fully serving and Tauri has launched.
  // The exit handler below only escalates crashes that happen AFTER startup.
  let startupComplete = false

  // Start Vite on the preferred port without --strictPort so it falls back
  // automatically when 1420 is in use.  We read the actual bound port from
  // Vite's startup banner instead of probing upfront (which has a TOCTOU gap).
  const viteChild = spawn(
    'pnpm',
    ['exec', 'vite', '--port', String(PREFERRED_DEV_PORT), '--host', DEV_SERVER_HOST],
    {
      cwd: projectRoot,
      // Pipe stdout/stderr so detectVitePort can read them while forwarding
      // every byte to the terminal for the developer.
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: true,
    }
  )

  // Only raise unexpected-exit alarms after startup is complete; during
  // startup, detectVitePort / waitForHttp already surface failures cleanly.
  viteChild.on('exit', (code) => {
    if (!viteShuttingDown && startupComplete && code !== 0 && code !== null) {
      console.error(`Vite exited unexpectedly with code ${code}`)
      process.exit(code ?? 1)
    }
  })

  let port
  let devUrl

  try {
    port = await detectVitePort(viteChild)
    devUrl = `http://${DEV_SERVER_HOST}:${port}`
    await waitForHttp(devUrl, 120_000, 200)
  } catch (err) {
    // Ensure Vite does not linger when startup fails.
    viteShuttingDown = true
    if (!viteChild.killed) viteChild.kill('SIGTERM')
    throw err
  }

  startupComplete = true

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
    }
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
