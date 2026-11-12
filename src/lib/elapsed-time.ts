import { MILLISECONDS_PER_SECOND, SECONDS_PER_HOUR, SECONDS_PER_MINUTE } from './units'

/**
 * Formats a duration in milliseconds into a compact human-readable string.
 * Examples:
 *   0      → "0s"
 *   3000   → "3s"
 *   59000  → "59s"
 *   60000  → "1m 0s"
 *   83000  → "1m 23s"
 *   3600000 → "1h 0m 0s"
 *   3723000 → "1h 2m 3s"
 *   -100   → "0s"
 */
export function formatElapsedTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / MILLISECONDS_PER_SECOND))
  const hours = Math.floor(totalSeconds / SECONDS_PER_HOUR)
  const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE)
  const seconds = totalSeconds % SECONDS_PER_MINUTE

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}
