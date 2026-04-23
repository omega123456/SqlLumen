/** Formats an ISO timestamp for display in data tables (e.g., "Jan 5, 14:22"). */
export function formatTableTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

/** Formats an ISO timestamp as a short date with year (e.g., "Jun 15, 2025"). */
export function formatShortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

/** Formats a Unix epoch-seconds timestamp as a short date with year (e.g., "Jun 15, 2025"). */
export function formatFromEpochSeconds(ts: number): string {
  try {
    return new Date(ts * 1000).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return String(ts)
  }
}
