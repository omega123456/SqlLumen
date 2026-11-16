import { format, parseISO } from 'date-fns'
import { isPlaywrightBuild } from './tauri-env'

const PLAYWRIGHT_FIXED_REFRESH_TIMESTAMP = parseISO('2025-01-01T12:00:00').getTime()
const REFRESH_TIME_FORMAT = 'HH:mm:ss'

export function getProcessListRefreshTimestamp(): number {
  return isPlaywrightBuild() ? PLAYWRIGHT_FIXED_REFRESH_TIMESTAMP : Date.now()
}

export function formatProcessListRefreshTime(ts: number): string {
  return format(ts, REFRESH_TIME_FORMAT)
}
