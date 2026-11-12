import { useState, useCallback, useEffect, useMemo } from 'react'
import { Checkbox } from '../common/Checkbox'
import { TextInput } from '../common/TextInput'
import { DialogShell } from './DialogShell'
import { Button } from '../common/Button'
import { InfoBar } from '../common/InfoBar'
import {
  listExportableObjects,
  startSqlDump,
  getDumpProgress,
  cancelDump,
  type ExportableDatabase,
  type DumpOptions,
  type DumpJobProgress,
  type DumpTableEntry,
} from '../../lib/sql-dump-commands'
import { showSuccessToast, showErrorToast } from '../../stores/toast-store'
import styles from './SqlDumpDialog.module.css'

import { logFrontend, logFrontendError } from '../../lib/app-log-commands'
import { toErrorMessage } from '../../lib/error-message'
import { isPlaywrightBuild } from '../../lib/tauri-env'
import { progressPercent } from '../../lib/job-progress'
import { useJobProgressPolling } from '../../hooks/useJobProgressPolling'
import { useBrowseFilePath } from '../../hooks/useBrowseFilePath'

interface InitialTableSelectionRequest {
  databases: ExportableDatabase[]
  initialDatabase?: string
  initialTable?: string
}

function buildInitialTableSelection({
  databases,
  initialDatabase,
  initialTable,
}: InitialTableSelectionRequest): Record<string, Set<string>> {
  if (!initialDatabase) return {}
  const database = databases.find((candidate) => candidate.name === initialDatabase)
  if (!database) return {}
  if (initialTable) return { [initialDatabase]: new Set([initialTable]) }
  return { [initialDatabase]: new Set(database.tables.map((table) => table.name)) }
}

export interface SqlDumpDialogProps {
  connectionId: string
  /** Pre-selected database name (e.g. from context menu on a specific database). */
  initialDatabase?: string
  /** Pre-selected table name (only when a specific table node was right-clicked). */
  initialTable?: string
  /** Whether to only include DDL (schema-only). When true, "Include data" is unchecked. */
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

  const { filePath, setFilePath, browseForFilePath } = useBrowseFilePath('sql-dump-dialog')

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
  const [cancelPending, setCancelPending] = useState(false)

  useEffect(() => {
    let cancelled = false

    const loadObjects = async () => {
      setLoadingObjects(true)
      setLoadError(null)
      try {
        const loadedDatabases = await listExportableObjects(connectionId)
        if (cancelled) return
        setDatabases(loadedDatabases)
        setSelectedTables(
          buildInitialTableSelection({
            databases: loadedDatabases,
            initialDatabase: initialDatabase,
            initialTable: initialTable,
          })
        )
      } catch (error) {
        if (cancelled) return
        const message = toErrorMessage(error)
        setLoadError(message)
        logFrontendError('[sql-dump] Failed to load exportable objects:', message)
      } finally {
        if (!cancelled) setLoadingObjects(false)
      }
    }

    void loadObjects()

    return () => {
      cancelled = true
    }
  }, [connectionId, initialDatabase, initialTable])

  const handleDumpFinished = (finishedProgress: DumpJobProgress) => {
    setIsExporting(false)
    if (finishedProgress.status === 'completed') {
      showSuccessToast('Export completed', `SQL dump saved to ${filePath}`)
      onClose()
      return
    }
    if (finishedProgress.status === 'cancelled') {
      setCancelPending(false)
      setError(
        `Export cancelled — ${finishedProgress.tablesDone} of ${finishedProgress.tablesTotal} tables were written to the file`
      )
      return
    }
    showErrorToast('Export failed', finishedProgress.errorMessage ?? 'SQL dump failed')
    setError(finishedProgress.errorMessage ?? 'Export failed')
  }

  useJobProgressPolling({
    jobId: jobId,
    fetchProgress: getDumpProgress,
    onProgress: setProgress,
    onFinished: handleDumpFinished,
    pollFailureMessage: '[sql-dump] Failed to poll progress:',
  })

  // Toggle a single table
  const toggleTable = useCallback((dbName: string, tableName: string) => {
    setSelectedTables((previous) => {
      const copy = { ...previous }
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
      setSelectedTables((previous) => {
        const copy = { ...previous }
        const db = databases.find((database) => database.name === dbName)
        if (!db) return previous
        const allTableNames = db.tables.map((table) => table.name)
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

  const handleBrowse = useCallback(() => {
    const defaultName = initialDatabase
      ? `${initialDatabase}_dump_${Date.now()}.sql`
      : `sql_dump_${Date.now()}.sql`
    return browseForFilePath({
      defaultPath: defaultName,
      filterName: 'SQL files',
      extension: 'sql',
    })
  }, [browseForFilePath, initialDatabase])

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

    // Enrich selected object names with type metadata from the loaded listing
    const tables: Record<string, DumpTableEntry[]> = {}
    const dbList: string[] = []
    for (const [dbName, tableSet] of Object.entries(selectedTables)) {
      if (tableSet.size === 0) continue
      const db = databases.find((database) => database.name === dbName)
      const entries: DumpTableEntry[] = []
      for (const objectName of tableSet) {
        const meta = db?.tables.find((table) => table.name === objectName)
        if (!meta) {
          setIsExporting(false)
          const message = `Cannot export: metadata not found for "${objectName}" in database "${dbName}"`
          setError(message)
          logFrontend('error', `[sql-dump] ${message}`)
          return
        }
        entries.push({ name: meta.name, objectType: meta.objectType })
      }
      dbList.push(dbName)
      tables[dbName] = entries
    }

    try {
      const id = await startSqlDump({
        connectionId: connectionId,
        filePath: filePath,
        databases: dbList,
        tables: tables,
        options: options,
      })
      setJobId(id)
    } catch (error) {
      setIsExporting(false)
      setError(toErrorMessage(error))
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
    databases,
  ])

  // Handle cancel
  const handleCancel = useCallback(async () => {
    if (!jobId || cancelPending) return
    setCancelPending(true)
    try {
      await cancelDump(jobId, connectionId)
    } catch (error) {
      setCancelPending(false)
      logFrontendError('[sql-dump] Failed to cancel export:', error)
    }
  }, [jobId, connectionId, cancelPending])

  const tablesPercent = progressPercent(progress?.tablesDone, progress?.tablesTotal)

  const canExport = filePath && hasSelection && !isExporting

  return (
    <DialogShell
      isOpen={true}
      onClose={onClose}
      maxWidth={520}
      testId="sql-dump-dialog"
      ariaLabel="Export SQL dump"
      disableFocusManagement={isPlaywrightBuild()}
      nonDismissible={isExporting}
    >
      <div className={styles.root}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>{schemaOnly ? 'Export schema DDL' : 'Export SQL dump'}</h2>
          {!isExporting && (
            <Button
              variant="bare"
              className={styles.closeButton}
              onClick={onClose}
              aria-label="Close"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </Button>
          )}
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
                  onChange={(event) => setIncludeStructure(event.target.checked)}
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
                  onChange={(event) => setIncludeData(event.target.checked)}
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
                  onChange={(event) => setIncludeDrop(event.target.checked)}
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
                  onChange={(event) => setUseTransaction(event.target.checked)}
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
                          ref={(element) => {
                            if (element) element.indeterminate = !!someSelected
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
                onChange={(event) => setFilePath(event.target.value)}
                placeholder="database_dump.sql"
                data-testid="dump-file-path-input"
              />
              <Button
                variant="bare"
                className={styles.browseButton}
                onClick={handleBrowse}
                aria-label="Browse"
                data-testid="dump-browse-button"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
              </Button>
            </div>
          </div>

          {/* Progress */}
          {isExporting && progress && (
            <div className={styles.progressSection} data-testid="dump-progress">
              <div className={styles.progressRow}>
                <span className={styles.progressLabel}>Tables</span>
                <div className={styles.progressBar}>
                  <div className={styles.progressFill} style={{ width: `${tablesPercent}%` }} />
                </div>
                <span className={styles.progressCount}>
                  {progress.tablesDone} / {progress.tablesTotal}
                </span>
              </div>
              {progress.currentTable && (
                <div className={styles.progressRow}>
                  <span className={styles.progressLabel}>{progress.currentTable}</span>
                  <span className={styles.rowCount} data-testid="dump-row-count">
                    {progress.rowsExported.toLocaleString()} rows
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className={styles.error} data-testid="dump-error">
              {error}
            </div>
          )}

          <InfoBar
            severity="info"
            message={
              <>
                {schemaOnly ? (
                  <>
                    Only <span className={styles.footerTextBold}>DDL statements</span> will be
                    exported (no data). Useful for version-controlling schema changes.
                  </>
                ) : (
                  <>Keep this dialog open while the export runs. Use Cancel export to stop it.</>
                )}
              </>
            }
            data-testid="dump-footer-text"
          />

          {/* Buttons */}
          <div className={styles.actions}>
            {isExporting ? (
              <Button
                type="button"
                onClick={handleCancel}
                disabled={cancelPending || progress?.cancelRequested}
                data-testid="dump-cancel-export-button"
              >
                {cancelPending || progress?.cancelRequested ? 'Cancelling...' : 'Cancel export'}
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="accent"
                  onClick={handleExport}
                  disabled={!canExport}
                  data-testid="dump-submit-button"
                >
                  Export
                </Button>
                <Button type="button" onClick={onClose} data-testid="dump-cancel-button">
                  Cancel
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </DialogShell>
  )
}
