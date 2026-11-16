import { fromUnixTime, intlFormat, parseISO } from 'date-fns'
import { logParseFallback } from './app-log-commands'

export function formatTableTimestamp(iso: string): string {
  try {
    return intlFormat(parseISO(iso), {
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
    return intlFormat(parseISO(iso), {
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
    return intlFormat(fromUnixTime(ts), {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch (error) {
    logParseFallback('[format-utils] formatFromEpochSeconds', error)
    return String(ts)
  }
}
