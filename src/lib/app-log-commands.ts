import { invoke } from '@tauri-apps/api/core'

export type FrontendLogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace'

const LOG_DELIVERY_FAILURE_PREFIX = '[app-log]'
const BOOTSTRAP_FAILURE_PREFIX = '[bootstrap]'

/**
 * Emit a line to the application logger (Rust tracing). Fire-and-forget.
 * Use for operational / user-visible failures — not console alone.
 */
export function logFrontend(level: FrontendLogLevel, message: string): void {
  invoke('log_frontend', { level, message }).catch((err: unknown) => {
    console.error(LOG_DELIVERY_FAILURE_PREFIX, err)
  })
}

export function logParseFallback(source: string, error: unknown): void {
  logFrontend('debug', `${source} could not parse its input, using the fallback: ${String(error)}`)
}

export function logBootstrapFailure(error: unknown): void {
  console.error(BOOTSTRAP_FAILURE_PREFIX, error)
}
