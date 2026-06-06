import type { LogEntry, LogLevelFilter, LogPage } from '../../lib/log-commands'

const LOG_PAGE_SIZE = 50

const LEVEL_THRESHOLD: Record<Exclude<LogLevelFilter, 'all'>, number> = {
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
}

const LEVEL_SEQUENCE = ['error', 'warn', 'info', 'debug', 'trace'] as const

type LogLevelName = Uppercase<(typeof LEVEL_SEQUENCE)[number]>

const LONG_MESSAGE = [
  'Slow query exceeded the service threshold for checkout reconciliation.',
  'SELECT orders.id, orders.total_cents, payments.provider_reference, shipments.status',
  'FROM orders',
  'LEFT JOIN payments ON payments.order_id = orders.id',
  "LEFT JOIN shipments ON shipments.order_id = orders.id WHERE orders.updated_at >= '2026-06-06 08:00:00';",
].join('\n')

function levelToName(level: (typeof LEVEL_SEQUENCE)[number]): LogLevelName {
  return level.toUpperCase() as LogLevelName
}

function getLevelThreshold(level: LogLevelFilter): number | null {
  if (level === 'all') {
    return null
  }

  return LEVEL_THRESHOLD[level]
}

function buildDefaultLogEntries(): LogEntry[] {
  const newestTimestamp = Date.parse('2026-06-06T14:32:07.000Z')

  return Array.from({ length: 120 }, (_, index) => {
    const level = LEVEL_SEQUENCE[index % LEVEL_SEQUENCE.length]
    const timestamp = new Date(newestTimestamp - index * 60_000).toISOString()
    const message =
      index === 0
        ? LONG_MESSAGE
        : `[${levelToName(level)}] Mock application event ${String(index + 1).padStart(3, '0')} for deterministic Playwright logging coverage.`

    return {
      id: index + 1,
      timestamp,
      level: levelToName(level),
      target: index % 2 === 0 ? 'sqllumen::logging::writer' : 'sqllumen::mysql::query_log',
      message,
    }
  })
}

export const DEFAULT_LOG_ENTRIES: LogEntry[] = buildDefaultLogEntries()

function getEntrySeverity(entry: LogEntry): number {
  const lookup = entry.level.toLowerCase() as keyof typeof LEVEL_THRESHOLD
  return LEVEL_THRESHOLD[lookup] ?? LEVEL_THRESHOLD.trace
}

export function getLogsPageFixture(page: number, level: LogLevelFilter): LogPage {
  const normalizedPage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1
  const threshold = getLevelThreshold(level)
  const filteredEntries =
    threshold === null
      ? DEFAULT_LOG_ENTRIES
      : DEFAULT_LOG_ENTRIES.filter((entry) => getEntrySeverity(entry) <= threshold)

  const total = filteredEntries.length
  const startIndex = (normalizedPage - 1) * LOG_PAGE_SIZE

  return {
    entries: filteredEntries.slice(startIndex, startIndex + LOG_PAGE_SIZE),
    total,
    page: normalizedPage,
    pageSize: LOG_PAGE_SIZE,
  }
}

function parseTimestamp(value: string): number | null {
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? null : timestamp
}

export function getExportLogsFixture(startTimestamp: string, endTimestamp: string): number {
  const start = parseTimestamp(startTimestamp)
  const end = parseTimestamp(endTimestamp)

  if (start === null || end === null || end < start) {
    return 0
  }

  return DEFAULT_LOG_ENTRIES.filter((entry) => {
    const timestamp = Date.parse(entry.timestamp)
    return timestamp >= start && timestamp <= end
  }).length
}
