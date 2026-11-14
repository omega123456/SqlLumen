import { MILLISECONDS_PER_SECOND } from './units'
import { logParseFallback } from './app-log-commands'

export function formatTableTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch (error) {
    logParseFallback('[format-utils] formatTableTimestamp', error)
    return iso
  }
}

export function formatShortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch (error) {
    logParseFallback('[format-utils] formatShortDate', error)
    return iso
  }
}

export function formatFromEpochSeconds(ts: number): string {
  try {
    return new Date(ts * MILLISECONDS_PER_SECOND).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch (error) {
    logParseFallback('[format-utils] formatFromEpochSeconds', error)
    return String(ts)
  }
}
