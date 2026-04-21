const IS_PLAYWRIGHT = import.meta.env.VITE_PLAYWRIGHT === 'true'

const PLAYWRIGHT_FIXED_REFRESH_TIMESTAMP = Date.parse('2025-01-01T12:00:00.000Z')

function padTimeSegment(value: number): string {
  return String(value).padStart(2, '0')
}

function formatUtcTime(ts: number): string {
  const date = new Date(ts)
  return `${padTimeSegment(date.getUTCHours())}:${padTimeSegment(date.getUTCMinutes())}:${padTimeSegment(date.getUTCSeconds())}`
}

export function getProcessListRefreshTimestamp(): number {
  return IS_PLAYWRIGHT ? PLAYWRIGHT_FIXED_REFRESH_TIMESTAMP : Date.now()
}

export function formatProcessListRefreshTime(ts: number): string {
  if (IS_PLAYWRIGHT) {
    return formatUtcTime(ts)
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(ts))
}
