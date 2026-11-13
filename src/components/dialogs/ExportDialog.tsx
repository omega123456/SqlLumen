import { useState, useMemo, useCallback, useEffect, useRef, type RefObject } from 'react'
import { FolderOpen, X } from '@phosphor-icons/react'
import { Dropdown, type DropdownOption } from '../common/Dropdown'
import { TextInput } from '../common/TextInput'
import { Checkbox } from '../common/Checkbox'
import { InfoBar } from '../common/InfoBar'
import { DialogShell } from './DialogShell'
import { Button } from '../common/Button'
import { exportResults } from '../../lib/export-commands'
import { formatCount } from '../../lib/format-row-count'
import {
  useQueryStore,
  type ExportRowScope,
  type ResultExportJob,
  type SingleResultState,
  type TabQueryState,
} from '../../stores/query-store'
import type { ExportFormat, ExportOptions } from '../../types/schema'
import styles from './ExportDialog.module.css'
import {
  BYTES_PER_MEGABYTE,
  MILLISECONDS_PER_SECOND,
  SECONDS_PER_MINUTE,
  TWO_DIGIT_WIDTH,
} from '../../lib/units'
import { toErrorMessage } from '../../lib/error-message'
import { isPlaywrightBuild } from '../../lib/tauri-env'
import { useFormSubmit } from '../../hooks/useFormSubmit'
import { useBrowseFilePath } from '../../hooks/useBrowseFilePath'

const ONE_DECIMAL_BELOW_MEGABYTES = 10

interface ExportDialogProps {
  connectionId: string
  tabId: string
  onClose: () => void
  /** Optional result index for multi-result tabs. */
  resultIndex?: number
  /** When provided, called instead of the built-in exportResults() for custom export logic. */
  onExport?: (options: Required<ExportOptions>) => Promise<void>
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

const FORMAT_KEYS: readonly ExportFormat[] = ['csv', 'json', 'xlsx', 'sql-insert']

/** XLSX option description when the dialog offers "All rows" (wireframe 6). */
const XLSX_ALL_ROWS_DESCRIPTION = 'Excel (.xlsx) · up to 1,048,576 rows'

function keepTableNameForSqlInsertOnly(options: Required<ExportOptions>): ExportOptions {
  const tableName = options.format === 'sql-insert' ? options.tableName : undefined
  return { ...options, tableName: tableName }
}

/** Sentence naming the grid sort and filters a full export ignores. */
function ignoredViewMessage(hasSort: boolean, filterCount: number): string {
  const filters = `${filterCount} ${filterCount === 1 ? 'filter' : 'filters'}`
  const hasFilters = filterCount > 0
  if (hasSort && hasFilters) return `Your sort and ${filters} will be ignored.`
  if (hasSort) return 'Your sort will be ignored.'
  return `Your ${filters} will be ignored.`
}

/** `m:ss` for the elapsed time of a running export. */
function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.floor(elapsedMs / MILLISECONDS_PER_SECOND)
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE)
  const seconds = totalSeconds % SECONDS_PER_MINUTE
  return `${minutes}:${seconds.toString().padStart(TWO_DIGIT_WIDTH, '0')}`
}

/** Megabytes written, with one decimal below 10 MB. */
function formatMegabytes(bytes: number): string {
  const megabytes = bytes / BYTES_PER_MEGABYTE
  return megabytes < ONE_DECIMAL_BELOW_MEGABYTES
    ? megabytes.toFixed(1)
    : formatCount(Math.round(megabytes))
}

/**
 * Status line of a running export ("Building workbook…" until XLSX rows flow).
 * XLSX omits the MB segment: the workbook is written to disk only when it is
 * saved, so its byte count stays 0 while rows are added.
 */
function exportProgressText(job: ResultExportJob): string {
  const rows = job.progress?.rowsWritten ?? 0
  const isBuildingWorkbook = job.format === 'xlsx' && rows === 0
  if (isBuildingWorkbook) return 'Building workbook…'
  const elapsed = formatElapsed(job.progress?.elapsedMs ?? 0)
  if (job.format === 'xlsx') return `Rows written ${formatCount(rows)} · ${elapsed}`
  const bytes = job.progress?.bytesWritten ?? 0
  return `Rows written ${formatCount(rows)} · ${formatMegabytes(bytes)} MB · ${elapsed}`
}

type ExportResult = SingleResultState

const DEFAULT_EXPORT_TABLE_NAME = 'exported_results'
const RESULTS_EXPIRED_ERROR_MARKER = 'results_expired'

function resolveExportResultIndex(tab: TabQueryState, resultIndex: number | undefined): number {
  return resultIndex ?? Math.min(tab.activeResultIndex, Math.max(0, tab.results.length - 1))
}

function offersAllRowsExport(result: ExportResult | undefined, hasCustomExport: boolean): boolean {
  if (hasCustomExport) return false
  if (!result?.truncated) return false
  return result.fullExportBlockedReason === null && result.queryId !== null
}

interface ViewModifiers {
  viewRowCount: number
  filterCount: number
  hasSort: boolean
}

function viewModifiersOf(result: ExportResult | undefined): ViewModifiers {
  if (!result) return { viewRowCount: 0, filterCount: 0, hasSort: false }
  return {
    viewRowCount: result.viewRowCount,
    filterCount: result.filterModel.length,
    hasSort: result.sortColumn !== null,
  }
}

function runningExportJob(exportJob: ResultExportJob | undefined): ResultExportJob | null {
  if (exportJob?.status !== 'running') return null
  return exportJob
}

function isUnavailableFormat(format: ExportFormat, isView: boolean | undefined): boolean {
  return Boolean(isView) && format === 'sql-insert'
}

function formatDescription(key: ExportFormat, offersAllRows: boolean): string {
  const isAllRowsWorkbook = offersAllRows && key === 'xlsx'
  if (isAllRowsWorkbook) return XLSX_ALL_ROWS_DESCRIPTION
  return EXPORT_FORMAT_CONFIG[key].description
}

interface FullExportProgressProps {
  exportJob: ResultExportJob
  onCancel: () => void
}

function FullExportProgress({ exportJob, onCancel }: FullExportProgressProps) {
  return (
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
          onClick={onCancel}
          data-testid="export-cancel-full-button"
        >
          {exportJob.cancelRequested ? 'Cancelling…' : 'Cancel export'}
        </Button>
      </div>
    </div>
  )
}

interface RowScopeFieldProps {
  offersAllRows: boolean
  options: DropdownOption<ExportRowScope>[]
  value: ExportRowScope
  onChange: (scope: ExportRowScope) => void
}

function RowScopeField({ offersAllRows, options, value, onChange }: RowScopeFieldProps) {
  if (!offersAllRows) return null
  return (
    <div className={styles.fieldGroup}>
      <label className={styles.label} id="export-rows-label">
        Rows
      </label>
      <Dropdown
        id="export-rows"
        labelledBy="export-rows-label"
        options={options}
        value={value}
        onChange={onChange}
        data-testid="export-rows-select"
        className={styles.formatDropdownRoot}
        triggerClassName={styles.formatDropdownTrigger}
      />
    </div>
  )
}

interface IgnoredViewWarningProps {
  isAllRows: boolean
  modifiers: ViewModifiers
  onUseCurrentView: () => void
}

function IgnoredViewWarning({ isAllRows, modifiers, onUseCurrentView }: IgnoredViewWarningProps) {
  const hasViewModifiers = modifiers.hasSort || modifiers.filterCount > 0
  if (!isAllRows) return null
  if (!hasViewModifiers) return null
  return (
    <InfoBar
      severity="warning"
      polite
      title="Sort and filter aren't applied to all rows."
      message={ignoredViewMessage(modifiers.hasSort, modifiers.filterCount)}
      actions={
        <Button
          type="button"
          size="sm"
          onClick={onUseCurrentView}
          data-testid="export-use-current-view"
        >
          Use current view
        </Button>
      }
      data-testid="export-ignored-view-warning"
    />
  )
}

interface SheetLimitWarningProps {
  isAllRows: boolean
  format: ExportFormat
  onSwitchToCsv: () => void
}

function SheetLimitWarning({ isAllRows, format, onSwitchToCsv }: SheetLimitWarningProps) {
  if (!isAllRows) return null
  if (format !== 'xlsx') return null
  return (
    <InfoBar
      severity="warning"
      polite
      message="Excel sheets stop at 1,048,576 rows. Rows past that are not written."
      actions={
        <Button type="button" size="sm" onClick={onSwitchToCsv} data-testid="export-switch-to-csv">
          Switch to CSV
        </Button>
      }
      data-testid="export-sheet-limit-warning"
    />
  )
}

interface TableNameFieldProps {
  format: ExportFormat
  tableName: string
  onChange: (tableName: string) => void
}

function TableNameField({ format, tableName, onChange }: TableNameFieldProps) {
  if (!EXPORT_FORMAT_CONFIG[format].requiresTableName) return null
  return (
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
        onChange={(event) => onChange(event.target.value)}
        placeholder={DEFAULT_EXPORT_TABLE_NAME}
        data-testid="export-table-name-input"
      />
    </div>
  )
}

interface ExportDialogHeaderProps {
  canClose: boolean
  onClose: () => void
}

function ExportDialogHeader({ canClose, onClose }: ExportDialogHeaderProps) {
  return (
    <div className={styles.header}>
      <h2 className={styles.title}>Export results</h2>
      {canClose && (
        <Button variant="bare" className={styles.closeButton} onClick={onClose} aria-label="Close">
          <X size={20} aria-hidden="true" />
        </Button>
      )}
    </div>
  )
}

interface FormatFieldProps {
  options: DropdownOption<ExportFormat>[]
  format: ExportFormat
  onChange: (format: ExportFormat) => void
}

function FormatField({ options, format, onChange }: FormatFieldProps) {
  return (
    <div className={styles.fieldGroup}>
      <label className={styles.label} id="export-format-label">
        Format
      </label>
      <Dropdown
        id="export-format"
        labelledBy="export-format-label"
        options={options}
        value={format}
        onChange={onChange}
        data-testid="export-format-select"
        className={styles.formatDropdownRoot}
        triggerClassName={styles.formatDropdownTrigger}
      />
    </div>
  )
}

interface DestinationFieldProps {
  format: ExportFormat
  filePath: string
  onChange: (filePath: string) => void
  onBrowse: () => void
}

function DestinationField({ format, filePath, onChange, onBrowse }: DestinationFieldProps) {
  const extension = EXPORT_FORMAT_CONFIG[format].extension
  return (
    <div className={styles.fieldGroup}>
      <label className={styles.label} htmlFor="export-file-path">
        Destination
      </label>
      <div className={styles.destinationGroup}>
        <span className={styles.destinationPrefix}>.{extension}</span>
        <TextInput
          id="export-file-path"
          variant="bare"
          type="text"
          className={styles.destinationInput}
          value={filePath}
          onChange={(event) => onChange(event.target.value)}
          placeholder={`query_results.${extension}`}
          data-testid="export-file-path-input"
        />
        <Button
          variant="bare"
          className={styles.browseButton}
          onClick={onBrowse}
          aria-label="Browse"
          data-testid="export-browse-button"
        >
          <FolderOpen size={20} aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}

interface IncludeHeadersFieldProps {
  checked: boolean
  onChange: (checked: boolean) => void
}

function IncludeHeadersField({ checked, onChange }: IncludeHeadersFieldProps) {
  return (
    <div className={styles.checkboxRow}>
      <Checkbox
        id="export-include-headers"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        data-testid="export-include-headers-checkbox"
      />
      <label htmlFor="export-include-headers" className={styles.checkboxLabel}>
        Include column headers in first row
      </label>
    </div>
  )
}

function ExportError({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <div className={styles.error} data-testid="export-error">
      {error}
    </div>
  )
}

interface FullExportOutcomeProps {
  exportJob: ResultExportJob | undefined
  failureBarRef: RefObject<HTMLDivElement | null>
  onRetry: () => void
}

function FullExportOutcome({ exportJob, failureBarRef, onRetry }: FullExportOutcomeProps) {
  if (exportJob?.status === 'cancelled') {
    return (
      <InfoBar
        severity="warning"
        title="Export cancelled"
        message="No file was written."
        data-testid="export-cancelled"
      />
    )
  }
  if (exportJob?.status !== 'failed') return null
  return (
    <InfoBar
      ref={failureBarRef}
      tabIndex={-1}
      severity="error"
      title="Export failed"
      message={exportJob.error}
      detail="No file was written."
      actions={
        <Button type="button" size="sm" onClick={onRetry} data-testid="export-try-again">
          Try again
        </Button>
      }
      data-testid="export-failed"
    />
  )
}

interface ExportFormActionsProps {
  canSubmit: boolean
  isExporting: boolean
  onClose: () => void
}

function ExportFormActions({ canSubmit, isExporting, onClose }: ExportFormActionsProps) {
  return (
    <div className={styles.actions}>
      <Button
        type="submit"
        variant="accent"
        disabled={!canSubmit}
        data-testid="export-submit-button"
      >
        {isExporting ? 'Exporting...' : 'Export'}
      </Button>
      <Button type="button" onClick={onClose} data-testid="export-cancel-button">
        Cancel
      </Button>
    </div>
  )
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
  const { filePath, setFilePath, browseForFilePath } = useBrowseFilePath('export-dialog')
  const [includeHeaders, setIncludeHeaders] = useState(true)
  const [tableName, setTableName] = useState(defaultTableName ?? DEFAULT_EXPORT_TABLE_NAME)
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The result this dialog exports, and the tab's full-export job (D22: the
  // store owns the job and its polling; the dialog only renders it).
  const resolvedResultIndex = useQueryStore((state) => {
    const tab = state.tabs[tabId]
    if (!tab) return 0
    return resolveExportResultIndex(tab, resultIndex)
  })
  const result = useQueryStore((state) => state.tabs[tabId]?.results[resolvedResultIndex])
  const exportJob = useQueryStore((state) => state.exportJobs[tabId])
  const startFullExport = useQueryStore((state) => state.startFullExport)
  const cancelFullExport = useQueryStore((state) => state.cancelFullExport)
  const markResultExpired = useQueryStore((state) => state.markResultExpired)

  /** "All rows" is offered only for truncated results that can be re-run. */
  const offersAllRows = offersAllRowsExport(result, onExport !== undefined)
  const [scope, setScope] = useState<ExportRowScope>(() =>
    offersAllRows && result ? result.preferredExportScope : 'currentView'
  )
  const effectiveScope: ExportRowScope = offersAllRows ? scope : 'currentView'
  const isAllRows = effectiveScope === 'allRows'
  const runningJob = runningExportJob(exportJob)
  const isFullExportRunning = runningJob !== null
  const failureBarRef = useRef<HTMLDivElement>(null)
  const exportJobStatus = exportJob?.status

  // A failed export moves focus to its InfoBar.
  useEffect(() => {
    if (exportJobStatus === 'failed') failureBarRef.current?.focus()
  }, [exportJobStatus])

  useEffect(() => {
    if (isUnavailableFormat(format, isView)) {
      setFormat('csv')
    }
  }, [isView, format])

  const formatDropdownOptions: DropdownOption<ExportFormat>[] = useMemo(
    () =>
      FORMAT_KEYS.filter((key) => !isUnavailableFormat(key, isView)).map((key) => ({
        value: key,
        label: EXPORT_FORMAT_CONFIG[key].label,
        description: formatDescription(key, offersAllRows),
      })),
    [isView, offersAllRows]
  )

  const viewModifiers = viewModifiersOf(result)
  const viewRowCount = viewModifiers.viewRowCount
  const rowScopeOptions: DropdownOption<ExportRowScope>[] = useMemo(
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

  const handleBrowse = useCallback(() => {
    const config = EXPORT_FORMAT_CONFIG[format]
    return browseForFilePath({
      defaultPath: `query_results_${Date.now()}.${config.extension}`,
      filterName: config.label,
      extension: config.extension,
    })
  }, [browseForFilePath, format])

  const handleExport = useCallback(async () => {
    if (!filePath) return
    const requestedOptions: Required<ExportOptions> = {
      format,
      filePath,
      includeHeaders,
      tableName,
    }
    const backendOptions = keepTableNameForSqlInsertOnly(requestedOptions)
    if (isAllRows) {
      setError(null)
      await startFullExport(tabId, {
        ...backendOptions,
        connectionId: connectionId,
        resultIndex: resolvedResultIndex,
      })
      return
    }
    setIsExporting(true)
    setError(null)
    const exportCurrentView = onExport
      ? () => onExport(requestedOptions)
      : () =>
          exportResults({
            connectionId: connectionId,
            tabId: tabId,
            options: backendOptions,
            resultIndex: resultIndex,
          })
    try {
      await exportCurrentView()
      onClose()
    } catch (error) {
      const errorMessage = toErrorMessage(error)
      if (errorMessage.includes(RESULTS_EXPIRED_ERROR_MARKER)) {
        markResultExpired(tabId, resolvedResultIndex)
      }
      setError(errorMessage)
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
    isAllRows,
    startFullExport,
    resolvedResultIndex,
    markResultExpired,
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

  const handleSubmit = useFormSubmit(handleExport)
  const canSubmit = Boolean(filePath) && !isExporting

  return (
    <DialogShell
      isOpen={true}
      onClose={onClose}
      maxWidth={440}
      testId="export-dialog"
      ariaLabel="Export results"
      disableFocusManagement={isPlaywrightBuild()}
      nonDismissible={isFullExportRunning}
      formProps={{ onSubmit: handleSubmit }}
    >
      <div className={styles.root}>
        <ExportDialogHeader canClose={!isFullExportRunning} onClose={onClose} />

        {runningJob ? (
          <FullExportProgress
            exportJob={runningJob}
            onCancel={() => void cancelFullExport(tabId)}
          />
        ) : (
          <div className={styles.body}>
            <RowScopeField
              offersAllRows={offersAllRows}
              options={rowScopeOptions}
              value={effectiveScope}
              onChange={setScope}
            />
            <IgnoredViewWarning
              isAllRows={isAllRows}
              modifiers={viewModifiers}
              onUseCurrentView={() => setScope('currentView')}
            />

            <FormatField options={formatDropdownOptions} format={format} onChange={setFormat} />
            <SheetLimitWarning
              isAllRows={isAllRows}
              format={format}
              onSwitchToCsv={() => setFormat('csv')}
            />

            <DestinationField
              format={format}
              filePath={filePath}
              onChange={setFilePath}
              onBrowse={handleBrowse}
            />

            <TableNameField format={format} tableName={tableName} onChange={setTableName} />

            <IncludeHeadersField checked={includeHeaders} onChange={setIncludeHeaders} />
            <ExportError error={error} />

            <FullExportOutcome
              exportJob={exportJob}
              failureBarRef={failureBarRef}
              onRetry={handleRetryFullExport}
            />

            <ExportFormActions canSubmit={canSubmit} isExporting={isExporting} onClose={onClose} />
          </div>
        )}
      </div>
    </DialogShell>
  )
}
