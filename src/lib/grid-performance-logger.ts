import { logFrontend, type FrontendLogLevel } from './app-log-commands'

type LogSink = (level: FrontendLogLevel, message: string) => void

type FieldValue = string | number | boolean | null | undefined

export interface GridPerformanceContext {
  scope: string
  tabId?: string
  view?: string
  rows?: number
  columns?: number
  editMode?: string | null
}

interface MetricSummary {
  count: number
  totalMs: number
  maxMs: number
  slowCount: number
}

export interface GridPerformanceLoggerOptions {
  summaryIntervalMs?: number
  warnIntervalMs?: number
  sink?: LogSink
  now?: () => number
}

export interface GridPerformanceRecordOptions {
  thresholdMs?: number
  fields?: Record<string, FieldValue>
}

const DEFAULT_SUMMARY_INTERVAL_MS = 10_000
const DEFAULT_WARN_INTERVAL_MS = 10_000

function nowMs(): number {
  return globalThis.performance?.now() ?? Date.now()
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10
}

function sanitizeString(value: string): string {
  return value.replace(/\s+/g, ' ').slice(0, 240)
}

function formatValue(value: FieldValue): string | null {
  if (value === undefined) return null
  if (value === null) return 'null'
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(roundMs(value)) : 'null'
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return JSON.stringify(sanitizeString(value))
}

function formatFields(fields: Record<string, FieldValue>): string {
  return Object.entries(fields)
    .map(([key, value]) => {
      const formatted = formatValue(value)
      return formatted === null ? null : `${key}=${formatted}`
    })
    .filter((part): part is string => part !== null)
    .join(' ')
}

function readRuntimeFields(): Record<string, FieldValue> {
  const navigatorLike = globalThis.navigator
  return {
    platform: navigatorLike?.platform ?? 'unknown',
    userAgent: navigatorLike?.userAgent ?? 'unknown',
    dpr: globalThis.devicePixelRatio ?? 1,
    visibility: globalThis.document?.visibilityState ?? 'unknown',
  }
}

export class GridPerformanceLogger {
  private context: GridPerformanceContext
  private readonly summaryIntervalMs: number
  private readonly warnIntervalMs: number
  private readonly sink: LogSink
  private readonly now: () => number
  private readonly metrics = new Map<string, MetricSummary>()
  private readonly lastWarnAtByMetric = new Map<string, number>()
  private windowStartedAt: number
  private hasLoggedMount = false

  constructor(context: GridPerformanceContext, options: GridPerformanceLoggerOptions = {}) {
    this.context = context
    this.summaryIntervalMs = options.summaryIntervalMs ?? DEFAULT_SUMMARY_INTERVAL_MS
    this.warnIntervalMs = options.warnIntervalMs ?? DEFAULT_WARN_INTERVAL_MS
    this.sink = options.sink ?? logFrontend
    this.now = options.now ?? nowMs
    this.windowStartedAt = this.now()
  }

  updateContext(context: GridPerformanceContext): void {
    this.context = context
  }

  logMount(): void {
    if (this.hasLoggedMount) return
    this.hasLoggedMount = true
    this.emit('info', 'mount', readRuntimeFields())
  }

  increment(metric: string, amount = 1, fields?: Record<string, FieldValue>): void {
    const summary = this.getSummary(metric)
    summary.count += amount
    if (fields) {
      this.emit('debug', 'event', { metric, ...fields })
    }
    this.flushIfDue('interval')
  }

  recordTiming(
    metric: string,
    durationMs: number,
    options: GridPerformanceRecordOptions = {}
  ): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) return

    const summary = this.getSummary(metric)
    summary.count += 1
    summary.totalMs += durationMs
    summary.maxMs = Math.max(summary.maxMs, durationMs)

    const thresholdMs = options.thresholdMs
    if (thresholdMs !== undefined && durationMs >= thresholdMs) {
      summary.slowCount += 1
      const now = this.now()
      const lastWarnAt = this.lastWarnAtByMetric.get(metric) ?? -Infinity
      if (now - lastWarnAt >= this.warnIntervalMs) {
        this.lastWarnAtByMetric.set(metric, now)
        this.emit('warn', 'slow', {
          metric,
          durationMs,
          thresholdMs,
          ...options.fields,
        })
      }
    }

    this.flushIfDue('interval')
  }

  flush(reason: string): void {
    if (this.metrics.size === 0) return

    const now = this.now()
    const metrics = Array.from(this.metrics.entries())
      .map(([metric, summary]) => {
        const avgMs = summary.count > 0 ? summary.totalMs / summary.count : 0
        return `${metric}:count=${summary.count},avgMs=${roundMs(avgMs)},maxMs=${roundMs(
          summary.maxMs
        )},slow=${summary.slowCount}`
      })
      .join('|')

    this.emit('info', 'summary', {
      reason,
      windowMs: now - this.windowStartedAt,
      metrics,
    })
    this.metrics.clear()
    this.windowStartedAt = now
  }

  flushIfDue(reason: string): void {
    if (this.now() - this.windowStartedAt >= this.summaryIntervalMs) {
      this.flush(reason)
    }
  }

  private getSummary(metric: string): MetricSummary {
    const existing = this.metrics.get(metric)
    if (existing) return existing

    const summary: MetricSummary = { count: 0, totalMs: 0, maxMs: 0, slowCount: 0 }
    this.metrics.set(metric, summary)
    return summary
  }

  private emit(level: FrontendLogLevel, event: string, fields: Record<string, FieldValue>): void {
    this.sink(
      level,
      `[perf][${this.context.scope}] ${formatFields({
        event,
        tabId: this.context.tabId,
        view: this.context.view,
        rows: this.context.rows,
        columns: this.context.columns,
        editMode: this.context.editMode ?? 'read-only',
        ...fields,
      })}`
    )
  }
}

export function createGridPerformanceLogger(
  context: GridPerformanceContext,
  options?: GridPerformanceLoggerOptions
): GridPerformanceLogger {
  return new GridPerformanceLogger(context, options)
}
