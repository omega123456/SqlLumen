import { invokeCommand } from './ipc/dispatch'

export type FrontendLogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace'

const LOG_DELIVERY_FAILURE_PREFIX = '[app-log]'
const BOOTSTRAP_FAILURE_PREFIX = '[bootstrap]'

export function logFrontend(level: FrontendLogLevel, message: string): void {
  invokeCommand({ command: 'log_frontend', payload: { level, message } }).catch(
    (error: unknown) => {
      console.error(LOG_DELIVERY_FAILURE_PREFIX, error)
    }
  )
}

function describeFailure(message: string, error: unknown): string {
  return `${message} ${String(error)}`
}

export function logFrontendError(message: string, error: unknown): void {
  logFrontend('error', describeFailure(message, error))
}

export function logFrontendWarning(message: string, error: unknown): void {
  logFrontend('warn', describeFailure(message, error))
}

export function logParseFallback(source: string, error: unknown): void {
  logFrontend('debug', `${source} could not parse its input, using the fallback: ${String(error)}`)
}

export function logBootstrapFailure(error: unknown): void {
  console.error(BOOTSTRAP_FAILURE_PREFIX, error)
}
