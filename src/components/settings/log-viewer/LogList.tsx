import { format } from 'date-fns'
import { InfoBar } from '../../common/InfoBar'
import { SCROLLBAR, joinClassNames } from '../../../lib/class-names'
import type { LogEntry } from '../../../lib/log-commands'
import { LogLevelBadge } from '../LogLevelBadge'

const SKELETON_ROWS = 8
const STRIPE_CYCLE_LENGTH = 2

type RowStripe = 'odd' | 'even'
type RowTone = 'error' | 'warn'

const ROW_STRIPE_CLASSES: Record<RowStripe, string> = {
  odd: 'bg-light-surface-container-low hover:bg-light-surface-container dark:bg-dark-surface-container-low dark:hover:bg-dark-surface-container',
  even: 'bg-light-surface hover:bg-light-surface-container dark:bg-dark-surface dark:hover:bg-dark-surface-container',
}

const ROW_TONE_CLASSES: Record<RowTone, string> = {
  error: 'bg-light-error-a06 dark:bg-dark-error-a06',
  warn: 'bg-light-warning-a06 dark:bg-dark-warning-a06',
}

type CellKind = 'level' | 'message' | 'timestamp'
type SkeletonWidth = 'badge' | 'message' | 'timestamp'

const CELL_KIND_CLASSES: Record<CellKind, string> = {
  level: '',
  message:
    'font-mono text-size-caption leading-cozy text-light-on-surface dark:text-dark-on-surface',
  timestamp:
    'font-mono text-size-caption whitespace-nowrap text-light-on-surface-variant dark:text-dark-on-surface-variant',
}

const SKELETON_WIDTH_CLASSES: Record<SkeletonWidth, string> = {
  badge: 'w-14',
  message: 'w-7/10',
  timestamp: 'w-27.5',
}

function formatTimestamp(timestamp: string): string {
  return format(new Date(timestamp), 'MMM dd HH:mm:ss')
}

function stripeOf(rowIndex: number): RowStripe {
  if (rowIndex % STRIPE_CYCLE_LENGTH === 0) return 'odd'
  return 'even'
}

function toneOf(level: string): RowTone | null {
  const normalized = level.toLowerCase()
  if (normalized === 'error') return 'error'
  if (normalized === 'warn') return 'warn'
  return null
}

function rowBackground(level: string, rowIndex: number): string {
  const tone = toneOf(level)
  if (tone) return ROW_TONE_CLASSES[tone]
  return ROW_STRIPE_CLASSES[stripeOf(rowIndex)]
}

interface LogRowProps {
  level: string
  rowIndex: number
  children: React.ReactNode
}

function LogRow({ level, rowIndex, children }: LogRowProps) {
  return (
    <tr
      className={joinClassNames([
        '*:border-b *:border-light-stroke-divider *:px-3 *:py-2 *:align-top dark:*:border-dark-stroke-divider',
        rowBackground(level, rowIndex),
      ])}
    >
      {children}
    </tr>
  )
}

function LogCell({ kind, children }: { kind: CellKind; children: React.ReactNode }) {
  return <td className={CELL_KIND_CLASSES[kind]}>{children}</td>
}

function SkeletonBar({ width }: { width: SkeletonWidth }) {
  return (
    <span
      className={joinClassNames([
        'block h-3.5 rounded-control bg-light-fill-neutral-selected dark:bg-dark-fill-neutral-selected',
        SKELETON_WIDTH_CLASSES[width],
      ])}
    />
  )
}

function LogSkeletonBody() {
  return (
    <tbody data-testid="log-viewer-loading" aria-busy="true">
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <LogRow key={index} level="" rowIndex={index}>
          <LogCell kind="level">
            <SkeletonBar width="badge" />
          </LogCell>
          <LogCell kind="message">
            <SkeletonBar width="message" />
          </LogCell>
          <LogCell kind="timestamp">
            <SkeletonBar width="timestamp" />
          </LogCell>
        </LogRow>
      ))}
    </tbody>
  )
}

function LogEntriesBody({ entries }: { entries: LogEntry[] }) {
  return (
    <tbody>
      {entries.map((entry, index) => (
        <LogRow key={entry.id} level={entry.level} rowIndex={index}>
          <LogCell kind="level">
            <LogLevelBadge level={entry.level} />
          </LogCell>
          <LogCell kind="message">
            <span
              className="line-clamp-4 wrap-anywhere whitespace-pre-wrap"
              title={entry.message}
              data-testid={`log-viewer-message-${entry.id}`}
            >
              {entry.message}
            </span>
          </LogCell>
          <LogCell kind="timestamp">{formatTimestamp(entry.timestamp)}</LogCell>
        </LogRow>
      ))}
    </tbody>
  )
}

interface LogListProps {
  errorMessage: string | null
  isLoading: boolean
  entries: LogEntry[]
}

export function LogList({ errorMessage, isLoading, entries }: LogListProps) {
  if (errorMessage) {
    return (
      <InfoBar
        severity="error"
        className="m-4"
        message="Failed to load logs."
        data-testid="log-viewer-error"
      />
    )
  }
  const hasNoMatchingEntries = !isLoading && entries.length === 0
  if (hasNoMatchingEntries) {
    return (
      <div
        className="p-4 text-center text-size-caption text-light-on-surface-variant dark:text-dark-on-surface-variant"
        data-testid="log-viewer-empty"
      >
        No log entries match this filter.
      </div>
    )
  }
  return (
    <div className={joinClassNames(['overflow-auto', SCROLLBAR])}>
      <table className="w-full table-fixed border-collapse">
        <thead className="sticky top-0 z-1 bg-light-surface-container-high dark:bg-dark-surface-container-high">
          <tr className="*:border-b *:border-light-stroke-divider *:px-3 *:py-2 *:text-left *:font-body *:text-size-caption *:font-semibold *:text-light-on-surface-variant dark:*:border-dark-stroke-divider dark:*:text-dark-on-surface-variant">
            <th className="w-24" scope="col">
              Level
            </th>
            <th scope="col">Message</th>
            <th className="w-37" scope="col">
              Timestamp
            </th>
          </tr>
        </thead>
        {isLoading ? <LogSkeletonBody /> : <LogEntriesBody entries={entries} />}
      </table>
    </div>
  )
}
