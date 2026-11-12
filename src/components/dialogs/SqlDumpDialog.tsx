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
import { isCancelInFlight, progressPercent } from '../../lib/job-progress'
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

type TableSelection = Record<string, Set<string>>

function toggleTableSelection(
  selection: TableSelection,
  dbName: string,
  tableName: string
): TableSelection {
  const copy = { ...selection }
  const tableNames = new Set(copy[dbName] ?? [])
  const wasSelected = tableNames.has(tableName)
  if (wasSelected) tableNames.delete(tableName)
  if (!wasSelected) tableNames.add(tableName)
  delete copy[dbName]
  if (tableNames.size > 0) copy[dbName] = tableNames
  return copy
}

function toggleDatabaseSelection(
  selection: TableSelection,
  database: ExportableDatabase
): TableSelection {
  const copy = { ...selection }
  const allTableNames = database.tables.map((table) => table.name)
  const isFullySelected = copy[database.name]?.size === allTableNames.length
  delete copy[database.name]
  if (!isFullySelected) copy[database.name] = new Set(allTableNames)
  return copy
}

function dumpDefaultFileName(initialDatabase: string | undefined, timestamp: number): string {
  if (initialDatabase) return `${initialDatabase}_dump_${timestamp}.sql`
  return `sql_dump_${timestamp}.sql`
}

function objectCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'object' : 'objects'}`
}

interface DumpOptionCheckboxProps {
  id: string
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}

function DumpOptionCheckbox({ id, label, checked, onChange }: DumpOptionCheckboxProps) {
  return (
    <div className={styles.checkboxRow}>
      <Checkbox
        id={id}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        data-testid={id}
      />
      <label htmlFor={id} className={styles.checkboxLabel}>
        {label}
      </label>
    </div>
  )
}

interface DatabaseObjectGroupProps {
  database: ExportableDatabase
  selectedTableNames: Set<string> | undefined
  onToggleDatabase: (dbName: string) => void
  onToggleTable: (dbName: string, tableName: string) => void
}

function DatabaseObjectGroup({
  database,
  selectedTableNames,
  onToggleDatabase,
  onToggleTable,
}: DatabaseObjectGroupProps) {
  const selectedCount = selectedTableNames?.size ?? 0
  const tableCount = database.tables.length
  const allSelected = tableCount > 0 && selectedCount === tableCount
  const someSelected = selectedCount > 0 && !allSelected

  return (
    <div className={styles.objectGroup}>
      <div className={styles.objectGroupHeader}>
        <Checkbox
          checked={allSelected}
          ref={(element) => {
            if (element) element.indeterminate = someSelected
          }}
          onChange={() => onToggleDatabase(database.name)}
          data-testid={`dump-db-${database.name}`}
        />
        <span className={styles.objectGroupLabel}>{database.name}</span>
        <span className={styles.objectGroupCount}>({objectCountLabel(tableCount)})</span>
      </div>
      {database.tables.map((table) => (
        <div key={table.name} className={styles.objectItem}>
          <Checkbox
            checked={selectedTableNames?.has(table.name) ?? false}
            onChange={() => onToggleTable(database.name, table.name)}
            data-testid={`dump-table-${database.name}-${table.name}`}
          />
          <span className={styles.objectItemLabel}>{table.name}</span>
          <span className={styles.objectItemType}>{table.objectType}</span>
        </div>
      ))}
    </div>
  )
}

interface DumpObjectListProps {
  loadingObjects: boolean
  loadError: string | null
  databases: ExportableDatabase[]
  selectedTables: TableSelection
  onToggleDatabase: (dbName: string) => void
  onToggleTable: (dbName: string, tableName: string) => void
}

function DumpObjectList({
  loadingObjects,
  loadError,
  databases,
  selectedTables,
  onToggleDatabase,
  onToggleTable,
}: DumpObjectListProps) {
  if (loadingObjects) {
    return (
      <div className={styles.loadingObjects} data-testid="dump-loading-objects">
        Loading objects...
      </div>
    )
  }
  if (loadError) {
    return (
      <div className={styles.error} data-testid="dump-load-error">
        {loadError}
      </div>
    )
  }
  if (databases.length === 0) {
    return <div className={styles.loadingObjects}>No databases found</div>
  }
  return (
    <div className={styles.objectTree} data-testid="dump-object-tree">
      {databases.map((database) => (
        <DatabaseObjectGroup
          key={database.name}
          database={database}
          selectedTableNames={selectedTables[database.name]}
          onToggleDatabase={onToggleDatabase}
          onToggleTable={onToggleTable}
        />
      ))}
    </div>
  )
}

function dumpDialogTitle(schemaOnly: boolean): string {
  if (schemaOnly) return 'Export schema DDL'
  return 'Export SQL dump'
}

function selectionCountSuffix(selectedCount: number): string {
  if (selectedCount === 0) return ''
  return ` (${selectedCount})`
}

function DumpProgressPanel({ progress }: { progress: DumpJobProgress }) {
  const tablesPercent = progressPercent(progress.tablesDone, progress.tablesTotal)
  return (
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
  )
}

function DumpFooterMessage({ schemaOnly }: { schemaOnly: boolean }) {
  if (!schemaOnly) {
    return <>Keep this dialog open while the export runs. Use Cancel export to stop it.</>
  }
  return (
    <>
      Only <span className={styles.footerTextBold}>DDL statements</span> will be exported (no data).
      Useful for version-controlling schema changes.
    </>
  )
}

interface DumpActionsProps {
  isExporting: boolean
  isCancelling: boolean
  canExport: boolean
  onCancelExport: () => void
  onExport: () => void
  onClose: () => void
}

function DumpActions({
  isExporting,
  isCancelling,
  canExport,
  onCancelExport,
  onExport,
  onClose,
}: DumpActionsProps) {
  if (isExporting) {
    return (
      <div className={styles.actions}>
        <Button
          type="button"
          onClick={onCancelExport}
          disabled={isCancelling}
          data-testid="dump-cancel-export-button"
        >
          {isCancelling ? 'Cancelling...' : 'Cancel export'}
        </Button>
      </div>
    )
  }
  return (
    <div className={styles.actions}>
      <Button
        type="button"
        variant="accent"
        onClick={onExport}
        disabled={!canExport}
        data-testid="dump-submit-button"
      >
        Export
      </Button>
      <Button type="button" onClick={onClose} data-testid="dump-cancel-button">
        Cancel
      </Button>
    </div>
  )
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
  const [selectedTables, setSelectedTables] = useState<TableSelection>({})

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
    setSelectedTables((previous) => toggleTableSelection(previous, dbName, tableName))
  }, [])

  // Toggle an entire database
  const toggleDatabase = useCallback(
    (dbName: string) => {
      const database = databases.find((candidate) => candidate.name === dbName)
      if (!database) return
      setSelectedTables((previous) => toggleDatabaseSelection(previous, database))
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
    const defaultName = dumpDefaultFileName(initialDatabase, Date.now())
    return browseForFilePath({
      defaultPath: defaultName,
      filterName: 'SQL files',
      extension: 'sql',
    })
  }, [browseForFilePath, initialDatabase])

  // Handle export
  const handleExport = useCallback(async () => {
    if (!filePath) return
    if (!hasSelection) return
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
    if (!jobId) return
    if (cancelPending) return
    setCancelPending(true)
    try {
      await cancelDump(jobId, connectionId)
    } catch (error) {
      setCancelPending(false)
      logFrontendError('[sql-dump] Failed to cancel export:', error)
    }
  }, [jobId, connectionId, cancelPending])

  const canExport = Boolean(filePath) && hasSelection && !isExporting
  const isCancelling = isCancelInFlight(cancelPending, progress)

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
          <h2 className={styles.title}>{dumpDialogTitle(schemaOnly)}</h2>
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
              <DumpOptionCheckbox
                id="dump-include-structure"
                label="Structure"
                checked={includeStructure}
                onChange={setIncludeStructure}
              />
              <DumpOptionCheckbox
                id="dump-include-data"
                label="Data"
                checked={includeData}
                onChange={setIncludeData}
              />
              <DumpOptionCheckbox
                id="dump-include-drop"
                label="DROP IF EXISTS"
                checked={includeDrop}
                onChange={setIncludeDrop}
              />
              <DumpOptionCheckbox
                id="dump-use-transaction"
                label="Transaction"
                checked={useTransaction}
                onChange={setUseTransaction}
              />
            </div>
          </div>

          {/* Objects */}
          <div className={styles.fieldGroup}>
            <span className={styles.label}>
              Objects to Export{selectionCountSuffix(selectedCount)}
            </span>

            <DumpObjectList
              loadingObjects={loadingObjects}
              loadError={loadError}
              databases={databases}
              selectedTables={selectedTables}
              onToggleDatabase={toggleDatabase}
              onToggleTable={toggleTable}
            />
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
          {isExporting && progress && <DumpProgressPanel progress={progress} />}

          {/* Error */}
          {error && (
            <div className={styles.error} data-testid="dump-error">
              {error}
            </div>
          )}

          <InfoBar
            severity="info"
            message={<DumpFooterMessage schemaOnly={schemaOnly} />}
            data-testid="dump-footer-text"
          />

          {/* Buttons */}
          <DumpActions
            isExporting={isExporting}
            isCancelling={isCancelling}
            canExport={canExport}
            onCancelExport={handleCancel}
            onExport={handleExport}
            onClose={onClose}
          />
        </div>
      </div>
    </DialogShell>
  )
}
