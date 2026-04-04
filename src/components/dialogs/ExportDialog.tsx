import { useState, useMemo, useCallback } from 'react'
import { Dropdown, type DropdownOption } from '../common/Dropdown'
import { TextInput } from '../common/TextInput'
import { Checkbox } from '../common/Checkbox'
import { DialogShell } from './DialogShell'
import { exportResults } from '../../lib/export-commands'
import type { ExportFormat } from '../../types/schema'
import styles from './ExportDialog.module.css'

const isPlaywright = import.meta.env.VITE_PLAYWRIGHT === 'true'

interface ExportDialogProps {
  connectionId: string
  tabId: string
  /** Number of columns in the result set. */
  columnCount: number
  /** Total row count in the result set. */
  totalRows: number
  onClose: () => void
  /** When provided, called instead of the built-in exportResults() for custom export logic. */
  onExport?: (options: {
    format: string
    filePath: string
    includeHeaders: boolean
    tableName: string
  }) => Promise<void>
  /** When provided, used as the initial table name instead of 'exported_results'. */
  defaultTableName?: string
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
    description: 'Comma Separated Values',
  },
  json: {
    label: 'JSON (JavaScript Object Notation)',
    extension: 'json',
    supportsHeaders: false,
    requiresTableName: false,
    description: 'JSON Array of Objects',
  },
  xlsx: {
    label: 'Excel (.xlsx)',
    extension: 'xlsx',
    supportsHeaders: true,
    requiresTableName: false,
    description: 'Excel Spreadsheet (.xlsx)',
  },
  'sql-insert': {
    label: 'SQL INSERT Statements',
    extension: 'sql',
    supportsHeaders: false,
    requiresTableName: true,
    description: 'SQL INSERT Statements',
  },
}

/** All format keys in display order. */
const FORMAT_KEYS = Object.keys(EXPORT_FORMAT_CONFIG) as ExportFormat[]

export default function ExportDialog({
  connectionId,
  tabId,
  columnCount,
  totalRows,
  onClose,
  onExport,
  defaultTableName,
}: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('csv')
  const [filePath, setFilePath] = useState('')
  const [includeHeaders, setIncludeHeaders] = useState(true)
  const [tableName, setTableName] = useState(defaultTableName ?? 'exported_results')
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const formatDropdownOptions: DropdownOption[] = useMemo(
    () =>
      FORMAT_KEYS.map((key) => ({
        value: key,
        label: EXPORT_FORMAT_CONFIG[key].label,
        description: EXPORT_FORMAT_CONFIG[key].description,
      })),
    []
  )

  const estimatedSizeText = useMemo(() => {
    const estimatedBytes = totalRows * columnCount * 20
    if (estimatedBytes > 1_000_000) {
      return `${(estimatedBytes / 1_000_000).toFixed(1)} MB`
    }
    return `${Math.max(1, Math.round(estimatedBytes / 1_000))} KB`
  }, [totalRows, columnCount])

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
        await exportResults(connectionId, tabId, {
          format,
          filePath,
          includeHeaders,
          tableName: format === 'sql-insert' ? tableName : undefined,
        })
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsExporting(false)
    }
  }, [connectionId, tabId, format, filePath, includeHeaders, tableName, onClose, onExport])

  return (
    <DialogShell
      isOpen={true}
      onClose={onClose}
      maxWidth={440}
      testId="export-dialog"
      ariaLabel="Export Results"
      disableFocusManagement={isPlaywright}
    >
      <div className={styles.root}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>Export Results</h2>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className={styles.body}>
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
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
              </button>
            </div>
          </div>

          {/* Table Name (shown when format requires it) */}
          {EXPORT_FORMAT_CONFIG[format].requiresTableName && (
            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor="export-table-name">
                Table Name
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

          {/* Buttons */}
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.exportButton}
              onClick={handleExport}
              disabled={!filePath || isExporting}
              data-testid="export-submit-button"
            >
              {isExporting ? 'Exporting...' : 'Export'}
            </button>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={onClose}
              data-testid="export-cancel-button"
            >
              Cancel
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <span className={styles.footerIcon}>
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
            </svg>
          </span>
          <p className={styles.footerText} data-testid="export-estimated-size">
            Estimated size: <span className={styles.footerTextBold}>{estimatedSizeText}</span>.
            Large exports may take several minutes to process in the background.
          </p>
        </div>
      </div>
    </DialogShell>
  )
}
