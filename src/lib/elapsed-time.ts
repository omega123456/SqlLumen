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
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}
