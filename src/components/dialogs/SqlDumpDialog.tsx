import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { Checkbox } from '../common/Checkbox'
import { TextInput } from '../common/TextInput'
import { DialogShell } from './DialogShell'
import {
  listExportableObjects,
  startSqlDump,
  getDumpProgress,
  type ExportableDatabase,
  type DumpOptions,
  type DumpJobProgress,
} from '../../lib/sql-dump-commands'
import { showSuccessToast, showErrorToast } from '../../stores/toast-store'
import styles from './SqlDumpDialog.module.css'

const isPlaywright = import.meta.env.VITE_PLAYWRIGHT === 'true'

/** Polling interval for progress updates (ms). */
const PROGRESS_POLL_MS = 500

export interface SqlDumpDialogProps {
  connectionId: string
  /** Pre-selected database name (e.g. from context menu on a specific database). */
  initialDatabase?: string
  /** Pre-selected table name (only when a specific table node was right-clicked). */
  initialTable?: string
  /** Whether to only include DDL (schema-only). When true, "Include Data" is unchecked. */
  schemaOnly?: boolean
  onClose: () => void
}

export default function SqlDumpDialog({
  connectionId,
  initialDatabase,
  initialTable,
  schemaOnly = false,
  onClose,
}: SqlDumpDialogProps) {
  // Options
  const [includeStructure, setIncludeStructure] = useState(true)
  const [includeData, setIncludeData] = useState(!schemaOnly)
  const [includeDrop, setIncludeDrop] = useState(true)
  const [useTransaction, setUseTransaction] = useState(true)

  // File path
  const [filePath, setFilePath] = useState('')

  // Objects
  const [databases, setDatabases] = useState<ExportableDatabase[]>([])
  const [loadingObjects, setLoadingObjects] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Selection: dbName → Set<tableName>. If the set contains all tables for a DB, the whole DB is selected.
  const [selectedTables, setSelectedTables] = useState<Record<string, Set<string>>>({})

  // Export state
  const [isExporting, setIsExporting] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [progress, setProgress] = useState<DumpJobProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Load exportable objects on mount
  useEffect(() => {
    let cancelled = false
    setLoadingObjects(true)
    setLoadError(null)

    listExportableObjects(connectionId)
      .then((dbs) => {
        if (cancelled) return
        setDatabases(dbs)

        // Initialize selection based on props
        const initial: Record<string, Set<string>> = {}
        if (initialDatabase) {
          const db = dbs.find((d) => d.name === initialDatabase)
          if (db) {
            if (initialTable) {
              // Select just the one table
              initial[initialDatabase] = new Set([initialTable])
            } else {
              // Select all tables in this database
              initial[initialDatabase] = new Set(db.tables.map((t) => t.name))
            }
          }
        }
        setSelectedTables(initial)
      })
      .catch((err) => {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : String(err)
        setLoadError(msg)
        console.error('[sql-dump] Failed to load exportable objects:', msg)
      })
      .finally(() => {
        if (!cancelled) setLoadingObjects(false)
      })

    return () => {
      cancelled = true
    }
  }, [connectionId, initialDatabase, initialTable])

  // Poll for progress when we have a job ID
  useEffect(() => {
    if (!jobId) return

    const poll = () => {
      getDumpProgress(jobId)
        .then((p) => {
          setProgress(p)
          if (p.status === 'completed') {
            setIsExporting(false)
            if (pollRef.current) clearInterval(pollRef.current)
            pollRef.current = null
            showSuccessToast('Export completed', `SQL dump saved to ${filePath}`)
            onClose()
          } else if (p.status === 'failed') {
            setIsExporting(false)
            if (pollRef.current) clearInterval(pollRef.current)
            pollRef.current = null
            showErrorToast('Export failed', p.errorMessage ?? 'SQL dump failed')
            setError(p.errorMessage ?? 'Export failed')
          }
        })
        .catch((err) => {
          console.error('[sql-dump] Failed to poll progress:', err)
        })
    }

    pollRef.current = setInterval(poll, PROGRESS_POLL_MS)
    // Also poll immediately
    poll()

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [jobId, onClose])

  // Toggle a single table
  const toggleTable = useCallback((dbName: string, tableName: string) => {
    setSelectedTables((prev) => {
      const copy = { ...prev }
      const existing = copy[dbName] ? new Set(copy[dbName]) : new Set<string>()
      if (existing.has(tableName)) {
        existing.delete(tableName)
      } else {
        existing.add(tableName)
      }
      if (existing.size === 0) {
        delete copy[dbName]
      } else {
        copy[dbName] = existing
      }
      return copy
    })
  }, [])

  // Toggle an entire database
  const toggleDatabase = useCallback(
    (dbName: string) => {
      setSelectedTables((prev) => {
        const copy = { ...prev }
        const db = databases.find((d) => d.name === dbName)
        if (!db) return prev
        const allTableNames = db.tables.map((t) => t.name)
        const existing = copy[dbName]
        if (existing && existing.size === allTableNames.length) {
          // Deselect all
          delete copy[dbName]
        } else {
          // Select all
          copy[dbName] = new Set(allTableNames)
        }
        return copy
      })
    },
    [databases]
  )

  // Check if anything is selected
  const hasSelection = useMemo(() => {
    return Object.values(selectedTables).some((set) => set.size > 0)
  }, [selectedTables])

  // Count total selected tables
  const selectedCount = useMemo(() => {
    return Object.values(selectedTables).reduce((sum, set) => sum + set.size, 0)
  }, [selectedTables])

  // Handle browse
  const handleBrowse = useCallback(async () => {
    try {
      const { save } = await import('@tauri-apps/plugin-dialog')
      const defaultName = initialDatabase
        ? `${initialDatabase}_dump_${Date.now()}.sql`
        : `sql_dump_${Date.now()}.sql`
      const selectedPath = await save({
        defaultPath: defaultName,
        filters: [{ name: 'SQL Files', extensions: ['sql'] }],
      })
      if (selectedPath) setFilePath(selectedPath)
    } catch {
      // Dialog not available (e.g. in test/Playwright mode)
    }
  }, [initialDatabase])

  // Handle export
  const handleExport = useCallback(async () => {
    if (!filePath || !hasSelection) return
    setIsExporting(true)
    setError(null)

    const options: DumpOptions = {
      includeStructure,
      includeData,
      includeDrop,
      useTransaction,
    }

    // Build tables map
    const tables: Record<string, string[]> = {}
    const dbList: string[] = []
    for (const [dbName, tableSet] of Object.entries(selectedTables)) {
      if (tableSet.size > 0) {
        dbList.push(dbName)
        tables[dbName] = Array.from(tableSet)
      }
    }

    try {
      const id = await startSqlDump({
        connectionId,
        filePath,
        databases: dbList,
        tables,
        options,
      })
      setJobId(id)
    } catch (err) {
      setIsExporting(false)
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [
    filePath,
    hasSelection,
    includeStructure,
    includeData,
    includeDrop,
    useTransaction,
    selectedTables,
    connectionId,
  ])

  // Progress percentage
  const progressPercent = useMemo(() => {
    if (!progress || progress.tablesTotal === 0) return 0
    return Math.round((progress.tablesDone / progress.tablesTotal) * 100)
  }, [progress])

  const canExport = filePath && hasSelection && !isExporting

  return (
    <DialogShell
      isOpen={true}
      onClose={onClose}
      maxWidth={520}
      testId="sql-dump-dialog"
      ariaLabel="Export SQL Dump"
      disableFocusManagement={isPlaywright}
    >
      <div className={styles.root}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>{schemaOnly ? 'Export Schema DDL' : 'Export SQL Dump'}</h2>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className={styles.body}>
          {/* Options */}
          <div className={styles.fieldGroup}>
            <span className={styles.label}>Options</span>
            <div className={styles.optionsRow}>
              <div className={styles.checkboxRow}>
                <Checkbox
                  id="dump-include-structure"
                  checked={includeStructure}
                  onChange={(e) => setIncludeStructure(e.target.checked)}
                  data-testid="dump-include-structure"
                />
                <label htmlFor="dump-include-structure" className={styles.checkboxLabel}>
                  Structure
                </label>
              </div>
              <div className={styles.checkboxRow}>
                <Checkbox
                  id="dump-include-data"
                  checked={includeData}
                  onChange={(e) => setIncludeData(e.target.checked)}
                  data-testid="dump-include-data"
                />
                <label htmlFor="dump-include-data" className={styles.checkboxLabel}>
                  Data
                </label>
              </div>
              <div className={styles.checkboxRow}>
                <Checkbox
                  id="dump-include-drop"
                  checked={includeDrop}
                  onChange={(e) => setIncludeDrop(e.target.checked)}
                  data-testid="dump-include-drop"
                />
                <label htmlFor="dump-include-drop" className={styles.checkboxLabel}>
                  DROP IF EXISTS
                </label>
              </div>
              <div className={styles.checkboxRow}>
                <Checkbox
                  id="dump-use-transaction"
                  checked={useTransaction}
                  onChange={(e) => setUseTransaction(e.target.checked)}
                  data-testid="dump-use-transaction"
                />
                <label htmlFor="dump-use-transaction" className={styles.checkboxLabel}>
                  Transaction
                </label>
              </div>
            </div>
          </div>

          {/* Objects */}
          <div className={styles.fieldGroup}>
            <span className={styles.label}>
              Objects to Export{hasSelection ? ` (${selectedCount})` : ''}
            </span>

            {loadingObjects && (
              <div className={styles.loadingObjects} data-testid="dump-loading-objects">
                Loading objects...
              </div>
            )}

            {loadError && (
              <div className={styles.error} data-testid="dump-load-error">
                {loadError}
              </div>
            )}

            {!loadingObjects && !loadError && databases.length === 0 && (
              <div className={styles.loadingObjects}>No databases found</div>
            )}

            {!loadingObjects && !loadError && databases.length > 0 && (
              <div className={styles.objectTree} data-testid="dump-object-tree">
                {databases.map((db) => {
                  const dbSelected = selectedTables[db.name]
                  const allSelected = dbSelected?.size === db.tables.length && db.tables.length > 0
                  const someSelected = dbSelected && dbSelected.size > 0 && !allSelected

                  return (
                    <div key={db.name} className={styles.objectGroup}>
                      <div className={styles.objectGroupHeader}>
                        <Checkbox
                          checked={allSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = !!someSelected
                          }}
                          onChange={() => toggleDatabase(db.name)}
                          data-testid={`dump-db-${db.name}`}
                        />
                        <span className={styles.objectGroupLabel}>{db.name}</span>
                        <span className={styles.objectGroupCount}>
                          ({db.tables.length} {db.tables.length === 1 ? 'object' : 'objects'})
                        </span>
                      </div>
                      {db.tables.map((table) => (
                        <div key={table.name} className={styles.objectItem}>
                          <Checkbox
                            checked={dbSelected?.has(table.name) ?? false}
                            onChange={() => toggleTable(db.name, table.name)}
                            data-testid={`dump-table-${db.name}-${table.name}`}
                          />
                          <span className={styles.objectItemLabel}>{table.name}</span>
                          <span className={styles.objectItemType}>{table.objectType}</span>
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Destination */}
          <div className={styles.fieldGroup}>
            <label className={styles.label} htmlFor="dump-file-path">
              Destination
            </label>
            <div className={styles.destinationGroup}>
              <span className={styles.destinationPrefix}>.sql</span>
              <TextInput
                id="dump-file-path"
                variant="bare"
                type="text"
                className={styles.destinationInput}
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
                placeholder="database_dump.sql"
                data-testid="dump-file-path-input"
              />
              <button
                type="button"
                className={styles.browseButton}
                onClick={handleBrowse}
                aria-label="Browse"
                data-testid="dump-browse-button"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
              </button>
            </div>
          </div>

          {/* Progress */}
          {isExporting && progress && (
            <div className={styles.progressSection} data-testid="dump-progress">
              <div className={styles.progressBar}>
                <div className={styles.progressFill} style={{ width: `${progressPercent}%` }} />
              </div>
              <span className={styles.progressText}>
                {progress.currentTable
                  ? `Exporting ${progress.currentTable}...`
                  : `${progress.tablesDone} / ${progress.tablesTotal} tables`}
                {' — '}
                {progressPercent}%
              </span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className={styles.error} data-testid="dump-error">
              {error}
            </div>
          )}

          {/* Buttons */}
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.exportButton}
              onClick={handleExport}
              disabled={!canExport}
              data-testid="dump-submit-button"
            >
              {isExporting ? 'Exporting...' : 'Export'}
            </button>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={onClose}
              data-testid="dump-cancel-button"
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
          <p className={styles.footerText} data-testid="dump-footer-text">
            {schemaOnly ? (
              <>
                Only <span className={styles.footerTextBold}>DDL statements</span> will be exported
                (no data). Useful for version-controlling schema changes.
              </>
            ) : (
              <>
                Large tables may take several minutes to export. The dump runs in the background —
                you can close this dialog and check progress later.
              </>
            )}
          </p>
        </div>
      </div>
    </DialogShell>
  )
}
