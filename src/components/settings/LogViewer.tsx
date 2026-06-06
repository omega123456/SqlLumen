import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowsClockwise, FileArrowDown } from '@phosphor-icons/react'
import { format } from 'date-fns'
import { Button } from '../common/Button'
import { Dropdown } from '../common/Dropdown'
import { IconButton } from '../common/IconButton'
import { PaginationGroup } from '../shared/toolbar/PaginationGroup'
import { logFrontend } from '../../lib/app-log-commands'
import { type LogEntry, type LogLevelFilter, listLogs } from '../../lib/log-commands'
import { LogExportDialog } from './LogExportDialog'
import { LogLevelBadge } from './LogLevelBadge'
import styles from './LogViewer.module.css'

const PAGE_SIZE = 20
const AUTO_REFRESH_MS = 5000
const SKELETON_ROWS = 8

const LEVEL_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'error', label: 'Error+' },
  { value: 'warn', label: 'Warn+' },
  { value: 'info', label: 'Info+' },
  { value: 'debug', label: 'Debug+' },
  { value: 'trace', label: 'Trace' },
] as const

function formatTimestamp(timestamp: string): string {
  return format(new Date(timestamp), 'MMM dd HH:mm:ss')
}

function rowClass(level: string): string {
  const normalized = level.toLowerCase()
  if (normalized === 'error') return styles.rowError
  if (normalized === 'warn') return styles.rowWarn
  return ''
}

export function LogViewer() {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [levelFilter, setLevelFilter] = useState<LogLevelFilter>('all')
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [exportOpen, setExportOpen] = useState(false)
  const requestIdRef = useRef(0)

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const firstEntryIndex = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const lastEntryIndex = total === 0 ? 0 : Math.min(total, firstEntryIndex + entries.length - 1)
  const countSummary =
    total === 0 ? 'No log entries' : `${firstEntryIndex}-${lastEntryIndex} of ${total}`

  const loadPage = useCallback(
    async (nextPage: number, nextLevel: LogLevelFilter, refreshOnly = false) => {
      const requestId = ++requestIdRef.current
      if (refreshOnly) {
        setIsRefreshing(true)
      } else {
        setIsLoading(true)
      }

      try {
        const response = await listLogs(nextPage, nextLevel)
        if (requestId !== requestIdRef.current) {
          return
        }
        setEntries(response.entries)
        setTotal(response.total)
        // Only an explicit load reconciles the page; a background refresh must not
        // move the user off the page they are currently viewing.
        if (!refreshOnly) {
          setPage(response.page)
        }
        setErrorMessage(null)
      } catch (error) {
        if (requestId !== requestIdRef.current) {
          return
        }
        const message = error instanceof Error ? error.message : String(error)
        setErrorMessage(message)
        logFrontend('error', `[log-viewer] Failed to load logs: ${message}`)
      } finally {
        if (requestId === requestIdRef.current) {
          setIsLoading(false)
          setIsRefreshing(false)
        }
      }
    },
    []
  )

  useEffect(() => {
    void loadPage(page, levelFilter)
    // page and levelFilter are the fetch key for this view.
  }, [loadPage, page, levelFilter])

  useEffect(() => {
    if (!autoRefresh) {
      return
    }

    const intervalId = window.setInterval(() => {
      void loadPage(page, levelFilter, true)
    }, AUTO_REFRESH_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [autoRefresh, loadPage, page, levelFilter])

  const handlePageSubmit = useCallback(
    (nextPage: number) => setPage(Math.min(Math.max(1, nextPage), totalPages)),
    [totalPages]
  )

  const paginationProps = {
    currentPage: page,
    pageSize: PAGE_SIZE,
    totalPages,
    onPageSizeChange: () => {},
    onPrevPage: () => setPage((p) => Math.max(1, p - 1)),
    onNextPage: () => setPage((p) => Math.min(totalPages, p + 1)),
    onPageSubmit: handlePageSubmit,
    disabled: isLoading,
    showPageSize: false,
    showFirstLastButtons: true,
  } as const

  return (
    <>
      <section className={styles.container} aria-label="Application logs" data-testid="log-viewer">
        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            <Dropdown
              id="log-viewer-level-filter"
              ariaLabel="Severity level"
              options={LEVEL_OPTIONS.map((option) => ({ ...option }))}
              value={levelFilter}
              onChange={(value) => {
                setPage(1)
                setLevelFilter(value as LogLevelFilter)
              }}
              data-testid="log-viewer-level-filter"
              triggerClassName={styles.filterDropdown}
            />
          </div>

          <div className={styles.toolbarRight}>
            <IconButton
              aria-label="Refresh logs"
              title="Refresh logs"
              onClick={() => void loadPage(page, levelFilter, true)}
              className={`${styles.refreshButton} ${isRefreshing ? styles.refreshing : ''}`}
              data-testid="log-viewer-refresh"
            >
              <ArrowsClockwise size={16} weight="bold" />
            </IconButton>

            <button
              type="button"
              aria-label="Auto-refresh"
              aria-pressed={autoRefresh}
              onClick={() => setAutoRefresh((value) => !value)}
              className={`${styles.autoRefreshToggle} ${
                autoRefresh ? styles.autoRefreshActive : ''
              }`}
              data-testid="log-viewer-auto-refresh-status"
            >
              <span
                className={autoRefresh ? styles.pulseDot : styles.pulseDotOff}
                aria-hidden="true"
              />
              {autoRefresh ? 'Auto-refresh on' : 'Auto-refresh off'}
            </button>

            <Button
              variant="toolbar"
              onClick={() => setExportOpen(true)}
              data-testid="log-viewer-export"
            >
              <FileArrowDown size={14} weight="bold" />
              Export
            </Button>
          </div>
        </div>

        <div className={styles.paginationBar}>
          <PaginationGroup {...paginationProps} />
          <span className={styles.summary} data-testid="log-viewer-count-summary">
            {countSummary}
          </span>
        </div>

        {errorMessage ? (
          <div
            className={`${styles.state} ${styles.errorState}`}
            data-testid="log-viewer-error"
            role="alert"
          >
            Failed to load logs.
          </div>
        ) : !isLoading && entries.length === 0 ? (
          <div className={styles.state} data-testid="log-viewer-empty">
            No log entries match this filter.
          </div>
        ) : (
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
              {isLoading ? (
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
              ) : (
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
              )}
            </table>
          </div>
        )}

        <div className={styles.paginationBar}>
          <PaginationGroup {...paginationProps} />
          <span className={styles.summary}>{countSummary}</span>
        </div>
      </section>
      <LogExportDialog isOpen={exportOpen} onClose={() => setExportOpen(false)} />
    </>
  )
}
