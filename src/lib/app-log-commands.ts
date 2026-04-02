import { invoke } from '@tauri-apps/api/core'

export type FrontendLogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace'

/**
 * Emit a line to the application logger (Rust tracing). Fire-and-forget.
 * Use for operational / user-visible failures — not console alone.
 */
export function logFrontend(level: FrontendLogLevel, message: string): void {
  invoke('log_frontend', { level, message }).catch((err: unknown) => {
    console.error('[app-log]', err)
  })
}
