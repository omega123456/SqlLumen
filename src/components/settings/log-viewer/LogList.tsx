import { format } from 'date-fns'
import { InfoBar } from '../../common/InfoBar'
import type { LogEntry } from '../../../lib/log-commands'
import { LogLevelBadge } from '../LogLevelBadge'
import styles from '../LogViewer.module.css'

const SKELETON_ROWS = 8

function formatTimestamp(timestamp: string): string {
  return format(new Date(timestamp), 'MMM dd HH:mm:ss')
}

function rowClass(level: string): string {
  const normalized = level.toLowerCase()
  if (normalized === 'error') return styles.rowError
  if (normalized === 'warn') return styles.rowWarn
  return ''
}

function LogSkeletonBody() {
  return (
    <tbody data-testid="log-viewer-loading" aria-busy="true">
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <tr key={index} className={styles.row}>
          <td className={styles.cell}>
            <span className={`${styles.skeletonBar} ${styles.skeletonBadge}`} />
          </td>
          <td className={`${styles.cell} ${styles.messageCell}`}>
            <span className={`${styles.skeletonBar} ${styles.skeletonMessage}`} />
          </td>
          <td className={`${styles.cell} ${styles.timestampCell}`}>
            <span className={`${styles.skeletonBar} ${styles.skeletonTimestamp}`} />
          </td>
        </tr>
      ))}
    </tbody>
  )
}

function LogEntriesBody({ entries }: { entries: LogEntry[] }) {
  return (
    <tbody>
      {entries.map((entry) => (
        <tr key={entry.id} className={`${styles.row} ${rowClass(entry.level)}`}>
          <td className={styles.cell}>
            <LogLevelBadge level={entry.level} />
          </td>
          <td className={`${styles.cell} ${styles.messageCell}`}>
            <span
              className={styles.messageText}
              title={entry.message}
              data-testid={`log-viewer-message-${entry.id}`}
            >
              {entry.message}
            </span>
          </td>
          <td className={`${styles.cell} ${styles.timestampCell}`}>
            {formatTimestamp(entry.timestamp)}
          </td>
        </tr>
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
        className={styles.errorState}
        message="Failed to load logs."
        data-testid="log-viewer-error"
      />
    )
  }
  const hasNoMatchingEntries = !isLoading && entries.length === 0
  if (hasNoMatchingEntries) {
    return (
      <div className={styles.state} data-testid="log-viewer-empty">
        No log entries match this filter.
      </div>
    )
  }
  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead className={styles.tableHead}>
          <tr>
            <th className={`${styles.tableHeader} ${styles.levelColumn}`} scope="col">
              Level
            </th>
            <th className={styles.tableHeader} scope="col">
              Message
            </th>
            <th className={`${styles.tableHeader} ${styles.timestampColumn}`} scope="col">
              Timestamp
            </th>
          </tr>
        </thead>
        {isLoading ? <LogSkeletonBody /> : <LogEntriesBody entries={entries} />}
      </table>
    </div>
  )
}
