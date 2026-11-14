import { useCallback, useState } from 'react'
import { PaginationGroup } from '../shared/toolbar/PaginationGroup'
import { LogExportDialog } from './LogExportDialog'
import styles from './LogViewer.module.css'
import { LogList } from './log-viewer/LogList'
import { LogViewerToolbar } from './log-viewer/LogViewerToolbar'
import { LOG_PAGE_SIZE, useLogPages, type LogPages } from './log-viewer/use-log-pages'

function logCountSummary(total: number, page: number, entryCount: number): string {
  if (total === 0) return 'No log entries'
  const firstEntryIndex = (page - 1) * LOG_PAGE_SIZE + 1
  const lastEntryIndex = Math.min(total, firstEntryIndex + entryCount - 1)
  return `${firstEntryIndex}-${lastEntryIndex} of ${total}`
}

function usePaginationProps(logPages: LogPages) {
  const { page, setPage, total, isLoading } = logPages
  const totalPages = Math.max(1, Math.ceil(total / LOG_PAGE_SIZE))
  const handlePageSubmit = useCallback(
    (nextPage: number) => setPage(Math.min(Math.max(1, nextPage), totalPages)),
    [totalPages, setPage]
  )
  return {
    currentPage: page,
    pageSize: LOG_PAGE_SIZE,
    totalPages: totalPages,
    onPageSizeChange: () => {},
    onPrevPage: () => setPage((currentPage) => Math.max(1, currentPage - 1)),
    onNextPage: () => setPage((currentPage) => Math.min(totalPages, currentPage + 1)),
    onPageSubmit: handlePageSubmit,
    disabled: isLoading,
    showPageSize: false,
    showFirstLastButtons: true,
  } as const
}

export function LogViewer() {
  const logPages = useLogPages()
  const [exportOpen, setExportOpen] = useState(false)
  const paginationProps = usePaginationProps(logPages)
  const countSummary = logCountSummary(logPages.total, logPages.page, logPages.entries.length)

  return (
    <>
      <section className={styles.container} aria-label="Application logs" data-testid="log-viewer">
        <LogViewerToolbar logPages={logPages} onExport={() => setExportOpen(true)} />

        <div className={styles.paginationBar}>
          <PaginationGroup {...paginationProps} />
          <span className={styles.summary} data-testid="log-viewer-count-summary">
            {countSummary}
          </span>
        </div>

        <LogList
          errorMessage={logPages.errorMessage}
          isLoading={logPages.isLoading}
          entries={logPages.entries}
        />

        <div className={styles.paginationBar}>
          <PaginationGroup {...paginationProps} />
          <span className={styles.summary}>{countSummary}</span>
        </div>
      </section>
      <LogExportDialog isOpen={exportOpen} onClose={() => setExportOpen(false)} />
    </>
  )
}
