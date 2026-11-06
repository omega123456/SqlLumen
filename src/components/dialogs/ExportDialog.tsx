import { useState, useMemo, useCallback, useEffect, useRef, type FormEvent } from 'react'
import { FolderOpen, X } from '@phosphor-icons/react'
import { Dropdown, type DropdownOption } from '../common/Dropdown'
import { TextInput } from '../common/TextInput'
import { Checkbox } from '../common/Checkbox'
import { InfoBar } from '../common/InfoBar'
import { DialogShell } from './DialogShell'
import { Button } from '../common/Button'
import { exportResults } from '../../lib/export-commands'
import { formatCount } from '../../lib/format-row-count'
import { useQueryStore, type ExportRowScope, type ResultExportJob } from '../../stores/query-store'
import type { ExportFormat } from '../../types/schema'
import styles from './ExportDialog.module.css'

const isPlaywright = import.meta.env.VITE_PLAYWRIGHT === 'true'

interface ExportDialogProps {
  connectionId: string
  tabId: string
  onClose: () => void
  /** Optional result index for multi-result tabs. */
  resultIndex?: number
  /** When provided, called instead of the built-in exportResults() for custom export logic. */
  onExport?: (options: {
    format: string
    filePath: string
    includeHeaders: boolean
    tableName: string
  }) => Promise<void>
  /** When provided, used as the initial table name instead of 'exported_results'. */
  defaultTableName?: string
  /** When true, hides the SQL INSERT format option (views cannot be inserted into). */
  isView?: boolean
}

const EXPORT_FORMAT_CONFIG: Record<
  ExportFormat,
  {
    label: string
    extension: string
    supportsHeaders: boolean
    requiresTableName: boolean
    description: string
  }
> = {
  csv: {
    label: 'CSV (Comma Separated Values)',
    extension: 'csv',
    supportsHeaders: true,
    requiresTableName: false,
    description: 'Comma-separated values',
  },
  json: {
    label: 'JSON (JavaScript Object Notation)',
    extension: 'json',
    supportsHeaders: false,
    requiresTableName: false,
    description: 'JSON array of objects',
  },
  xlsx: {
    label: 'Excel (.xlsx)',
    extension: 'xlsx',
    supportsHeaders: true,
    requiresTableName: false,
    description: 'Excel Spreadsheet (.xlsx)',
  },
  'sql-insert': {
    label: 'SQL INSERT statements',
    extension: 'sql',
    supportsHeaders: false,
    requiresTableName: true,
    description: 'SQL INSERT statements',
  },
}

/** All format keys in display order. */
const FORMAT_KEYS = Object.keys(EXPORT_FORMAT_CONFIG) as ExportFormat[]

/** XLSX option description when the dialog offers "All rows" (wireframe 6). */
const XLSX_ALL_ROWS_DESCRIPTION = 'Excel (.xlsx) · up to 1,048,576 rows'

/** Sentence naming the grid sort and filters a full export ignores. */
function ignoredViewMessage(hasSort: boolean, filterCount: number): string {
  const filters = `${filterCount} ${filterCount === 1 ? 'filter' : 'filters'}`
  if (hasSort && filterCount > 0) return `Your sort and ${filters} will be ignored.`
  if (hasSort) return 'Your sort will be ignored.'
  return `Your ${filters} will be ignored.`
}

/** `m:ss` for the elapsed time of a running export. */
function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.floor(elapsedMs / 1000)
  const seconds = totalSeconds % 60
  return `${Math.floor(totalSeconds / 60)}:${seconds.toString().padStart(2, '0')}`
}

/** Megabytes written, with one decimal below 10 MB. */
function formatMegabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return mb < 10 ? mb.toFixed(1) : formatCount(Math.round(mb))
}

/**
 * Status line of a running export ("Building workbook…" until XLSX rows flow).
 * XLSX omits the MB segment: the workbook is written to disk only when it is
 * saved, so its byte count stays 0 while rows are added.
 */
function exportProgressText(job: ResultExportJob): string {
  const rows = job.progress?.rowsWritten ?? 0
  if (job.format === 'xlsx' && rows === 0) return 'Building workbook…'
  const elapsed = formatElapsed(job.progress?.elapsedMs ?? 0)
  if (job.format === 'xlsx') return `Rows written ${formatCount(rows)} · ${elapsed}`
  const bytes = job.progress?.bytesWritten ?? 0
  return `Rows written ${formatCount(rows)} · ${formatMegabytes(bytes)} MB · ${elapsed}`
}

export default function ExportDialog({
  connectionId,
  tabId,
  onClose,
  resultIndex,
  onExport,
  defaultTableName,
  isView,
}: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('csv')
  const [filePath, setFilePath] = useState('')
  const [includeHeaders, setIncludeHeaders] = useState(true)
  const [tableName, setTableName] = useState(defaultTableName ?? 'exported_results')
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The result this dialog exports, and the tab's full-export job (D22: the
  // store owns the job and its polling; the dialog only renders it).
  const resolvedResultIndex = useQueryStore((s) => {
    const tab = s.tabs[tabId]
    if (!tab) return 0
    return resultIndex ?? Math.min(tab.activeResultIndex, Math.max(0, tab.results.length - 1))
  })
  const result = useQueryStore((s) => s.tabs[tabId]?.results[resolvedResultIndex])
  const exportJob = useQueryStore((s) => s.exportJobs[tabId])
  const startFullExport = useQueryStore((s) => s.startFullExport)
  const cancelFullExport = useQueryStore((s) => s.cancelFullExport)

  /** "All rows" is offered only for truncated results that can be re-run. */
  const offersAllRows =
    !onExport &&
    result !== undefined &&
    result.truncated &&
    result.fullExportBlockedReason === null &&
    result.queryId !== null
  const [scope, setScope] = useState<ExportRowScope>(() =>
    offersAllRows ? result.preferredExportScope : 'currentView'
  )
  const effectiveScope: ExportRowScope = offersAllRows ? scope : 'currentView'
  const isFullExportRunning = exportJob?.status === 'running'
  const failureBarRef = useRef<HTMLDivElement>(null)
  const exportJobStatus = exportJob?.status

  // A failed export moves focus to its InfoBar.
  useEffect(() => {
    if (exportJobStatus === 'failed') failureBarRef.current?.focus()
  }, [exportJobStatus])

  // Guard: reset format to 'csv' if the current format is not available for views
  useEffect(() => {
    if (isView && format === 'sql-insert') {
      setFormat('csv')
    }
  }, [isView, format])

  const formatDropdownOptions: DropdownOption[] = useMemo(
    () =>
      FORMAT_KEYS.filter((key) => !(isView && key === 'sql-insert')).map((key) => ({
        value: key,
        label: EXPORT_FORMAT_CONFIG[key].label,
        description:
          offersAllRows && key === 'xlsx'
            ? XLSX_ALL_ROWS_DESCRIPTION
            : EXPORT_FORMAT_CONFIG[key].description,
      })),
    [isView, offersAllRows]
  )

  const viewRowCount = result?.viewRowCount ?? 0
  const rowScopeOptions: DropdownOption[] = useMemo(
    () => [
      {
        value: 'currentView',
        label: `Current view · ${formatCount(viewRowCount)} rows`,
        description: 'Rows in memory, with the current sort and filter. No re-run.',
      },
      {
        value: 'allRows',
        label: 'All rows · re-runs the query',
        description:
          'Streams every row to file. Sort and filter are not applied. Not limited by the row ceiling.',
      },
    ],
    [viewRowCount]
  )
  const filterCount = result?.filterModel.length ?? 0
  const hasSort = (result?.sortColumn ?? null) !== null
  const showIgnoredViewWarning = effectiveScope === 'allRows' && (hasSort || filterCount > 0)
  const showSheetLimitWarning = effectiveScope === 'allRows' && format === 'xlsx'

  const handleBrowse = useCallback(async () => {
    const config = EXPORT_FORMAT_CONFIG[format]
    try {
      const { save } = await import('@tauri-apps/plugin-dialog')
      const selectedPath = await save({
        defaultPath: `query_results_${Date.now()}.${config.extension}`,
        filters: [{ name: config.label, extensions: [config.extension] }],
      })
      if (selectedPath) setFilePath(selectedPath)
    } catch {
      // Dialog not available (e.g. in test/Playwright mode)
    }
  }, [format])

  const handleExport = useCallback(async () => {
    if (!filePath) return
    if (effectiveScope === 'allRows') {
      setError(null)
      await startFullExport(tabId, {
        connectionId,
        resultIndex: resolvedResultIndex,
        format,
        filePath,
        includeHeaders,
        tableName: format === 'sql-insert' ? tableName : undefined,
      })
      return
    }
    setIsExporting(true)
    setError(null)
    try {
      if (onExport) {
        await onExport({
          format,
          filePath,
          includeHeaders,
          tableName,
        })
      } else {
        await exportResults(
          connectionId,
          tabId,
          {
            format,
            filePath,
            includeHeaders,
            tableName: format === 'sql-insert' ? tableName : undefined,
          },
          resultIndex
        )
      }
      onClose()
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      if (errMsg.includes('results_expired')) {
        const tab = useQueryStore.getState().tabs[tabId]
        if (tab) {
          const expiredResultIndex =
            resultIndex ?? Math.min(tab.activeResultIndex, Math.max(0, tab.results.length - 1))
          useQueryStore.setState((state) => {
            const t = state.tabs[tabId]
            if (!t || expiredResultIndex >= t.results.length) return state
            const newResults = [...t.results]
            newResults[expiredResultIndex] = {
              ...newResults[expiredResultIndex],
              isExpired: true,
            }
            return {
              tabs: {
                ...state.tabs,
                [tabId]: { ...t, results: newResults },
              },
            }
          })
        }
      }
      setError(errMsg)
    } finally {
      setIsExporting(false)
    }
  }, [
    connectionId,
    tabId,
    format,
    filePath,
    includeHeaders,
    tableName,
    onClose,
    onExport,
    resultIndex,
    effectiveScope,
    startFullExport,
    resolvedResultIndex,
  ])

  const handleRetryFullExport = useCallback(() => {
    if (!exportJob) return
    void startFullExport(tabId, {
      connectionId: exportJob.connectionId,
      resultIndex: exportJob.resultIndex,
      format: exportJob.format,
      filePath: exportJob.filePath,
      includeHeaders: exportJob.includeHeaders,
      tableName: exportJob.tableName,
    })
  }, [exportJob, startFullExport, tabId])

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      void handleExport()
    },
    [handleExport]
  )

  return (
    <DialogShell
      isOpen={true}
      onClose={onClose}
      maxWidth={440}
      testId="export-dialog"
      ariaLabel="Export results"
      disableFocusManagement={isPlaywright}
      nonDismissible={isFullExportRunning}
      formProps={{ onSubmit: handleSubmit }}
    >
      <div className={styles.root}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>Export results</h2>
          {!isFullExportRunning && (
            <button
              type="button"
              className={styles.closeButton}
              onClick={onClose}
              aria-label="Close"
            >
              <X size={20} aria-hidden="true" />
            </button>
          )}
        </div>

        {isFullExportRunning && exportJob ? (
          /* Progress (All rows): the store polls the job; closing never cancels it. */
          <div className={styles.body}>
            <div className={styles.progressSection} data-testid="export-progress">
              <span className={styles.progressTitle} role="status">
                Exporting all rows…
              </span>
              <div className={styles.progressBar} aria-hidden="true">
                <div className={styles.progressIndicator} />
              </div>
              <span className={styles.progressStats} data-testid="export-progress-stats">
                {exportProgressText(exportJob)}
              </span>
            </div>
            <div className={`${styles.actions} ${styles.progressActions}`}>
              <Button
                type="button"
                disabled={exportJob.cancelRequested}
                onClick={() => void cancelFullExport(tabId)}
                data-testid="export-cancel-full-button"
              >
                {exportJob.cancelRequested ? 'Cancelling…' : 'Cancel export'}
              </Button>
            </div>
          </div>
        ) : (
          <div className={styles.body}>
            {/* Rows (truncated, re-runnable results only) */}
            {offersAllRows && (
              <div className={styles.fieldGroup}>
                <label className={styles.label} id="export-rows-label">
                  Rows
                </label>
                <Dropdown
                  id="export-rows"
                  labelledBy="export-rows-label"
                  options={rowScopeOptions}
                  value={effectiveScope}
                  onChange={(v) => setScope(v as ExportRowScope)}
                  data-testid="export-rows-select"
                  className={styles.formatDropdownRoot}
                  triggerClassName={styles.formatDropdownTrigger}
                />
              </div>
            )}
            {showIgnoredViewWarning && (
              <InfoBar
                severity="warning"
                polite
                title="Sort and filter aren't applied to all rows."
                message={ignoredViewMessage(hasSort, filterCount)}
                actions={
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setScope('currentView')}
                    data-testid="export-use-current-view"
                  >
                    Use current view
                  </Button>
                }
                data-testid="export-ignored-view-warning"
              />
            )}

            {/* Format */}
            <div className={styles.fieldGroup}>
              <label className={styles.label} id="export-format-label">
                Format
              </label>
              <Dropdown
                id="export-format"
                labelledBy="export-format-label"
                options={formatDropdownOptions}
                value={format}
                onChange={(v) => setFormat(v as ExportFormat)}
                data-testid="export-format-select"
                className={styles.formatDropdownRoot}
                triggerClassName={styles.formatDropdownTrigger}
              />
            </div>
            {showSheetLimitWarning && (
              <InfoBar
                severity="warning"
                polite
                message="Excel sheets stop at 1,048,576 rows. Rows past that are not written."
                actions={
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setFormat('csv')}
                    data-testid="export-switch-to-csv"
                  >
                    Switch to CSV
                  </Button>
                }
                data-testid="export-sheet-limit-warning"
              />
            )}

            {/* Destination */}
            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor="export-file-path">
                Destination
              </label>
              <div className={styles.destinationGroup}>
                <span className={styles.destinationPrefix}>
                  .{EXPORT_FORMAT_CONFIG[format].extension}
                </span>
                <TextInput
                  id="export-file-path"
                  variant="bare"
                  type="text"
                  className={styles.destinationInput}
                  value={filePath}
                  onChange={(e) => setFilePath(e.target.value)}
                  placeholder={`query_results.${EXPORT_FORMAT_CONFIG[format].extension}`}
                  data-testid="export-file-path-input"
                />
                <button
                  type="button"
                  className={styles.browseButton}
                  onClick={handleBrowse}
                  aria-label="Browse"
                  data-testid="export-browse-button"
                >
                  <FolderOpen size={20} aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* Table Name (shown when format requires it) */}
            {EXPORT_FORMAT_CONFIG[format].requiresTableName && (
              <div className={styles.fieldGroup}>
                <label className={styles.label} htmlFor="export-table-name">
                  Table name
                </label>
                <TextInput
                  id="export-table-name"
                  variant="bare"
                  type="text"
                  className={styles.tableNameInput}
                  value={tableName}
                  onChange={(e) => setTableName(e.target.value)}
                  placeholder="exported_results"
                  data-testid="export-table-name-input"
                />
              </div>
            )}

            {/* Include headers checkbox */}
            <div className={styles.checkboxRow}>
              <Checkbox
                id="export-include-headers"
                checked={includeHeaders}
                onChange={(e) => setIncludeHeaders(e.target.checked)}
                data-testid="export-include-headers-checkbox"
              />
              <label htmlFor="export-include-headers" className={styles.checkboxLabel}>
                Include column headers in first row
              </label>
            </div>

            {/* Error */}
            {error && (
              <div className={styles.error} data-testid="export-error">
                {error}
              </div>
            )}

            {exportJob?.status === 'cancelled' && (
              <InfoBar
                severity="warning"
                title="Export cancelled"
                message="No file was written."
                data-testid="export-cancelled"
              />
            )}
            {exportJob?.status === 'failed' && (
              <InfoBar
                ref={failureBarRef}
                tabIndex={-1}
                severity="error"
                title="Export failed"
                message={exportJob.error}
                detail="No file was written."
                actions={
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleRetryFullExport}
                    data-testid="export-try-again"
                  >
                    Try again
                  </Button>
                }
                data-testid="export-failed"
              />
            )}

            {/* Buttons */}
            <div className={styles.actions}>
              <Button
                type="submit"
                variant="accent"
                disabled={!filePath || isExporting}
                data-testid="export-submit-button"
              >
                {isExporting ? 'Exporting...' : 'Export'}
              </Button>
              <Button type="button" onClick={onClose} data-testid="export-cancel-button">
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </DialogShell>
  )
}
