import { Checkbox } from '../../common/Checkbox'
import { TextInput } from '../../common/TextInput'
import { Button } from '../../common/Button'
import type {
  DumpJobProgress,
  DumpOptions,
  ExportableDatabase,
} from '../../../lib/sql-dump-commands'
import { progressPercent } from '../../../lib/job-progress'
import type { TableSelection } from '../sql-dump-selection'
import styles from '../SqlDumpDialog.module.css'

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

export function DumpProgressPanel({ progress }: { progress: DumpJobProgress }) {
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

export function DumpFooterMessage({ schemaOnly }: { schemaOnly: boolean }) {
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

export function DumpActions({
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

interface DumpOptionSpec {
  id: string
  label: string
  option: keyof DumpOptions
}

const DUMP_OPTION_SPECS: DumpOptionSpec[] = [
  { id: 'dump-include-structure', label: 'Structure', option: 'includeStructure' },
  { id: 'dump-include-data', label: 'Data', option: 'includeData' },
  { id: 'dump-include-drop', label: 'DROP IF EXISTS', option: 'includeDrop' },
  { id: 'dump-use-transaction', label: 'Transaction', option: 'useTransaction' },
]

interface DumpOptionsGroupProps {
  options: DumpOptions
  onChange: (option: keyof DumpOptions, checked: boolean) => void
}

export function DumpOptionsGroup({ options, onChange }: DumpOptionsGroupProps) {
  return (
    <div className={styles.fieldGroup}>
      <span className={styles.label}>Options</span>
      <div className={styles.optionsRow}>
        {DUMP_OPTION_SPECS.map((spec) => (
          <DumpOptionCheckbox
            key={spec.id}
            id={spec.id}
            label={spec.label}
            checked={options[spec.option]}
            onChange={(checked) => onChange(spec.option, checked)}
          />
        ))}
      </div>
    </div>
  )
}

interface DumpDestinationFieldProps {
  filePath: string
  onFilePathChange: (filePath: string) => void
  onBrowse: () => void
}

export function DumpDestinationField({
  filePath,
  onFilePathChange,
  onBrowse,
}: DumpDestinationFieldProps) {
  return (
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
          onChange={(event) => onFilePathChange(event.target.value)}
          placeholder="database_dump.sql"
          data-testid="dump-file-path-input"
        />
        <Button
          variant="bare"
          className={styles.browseButton}
          onClick={onBrowse}
          aria-label="Browse"
          data-testid="dump-browse-button"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
        </Button>
      </div>
    </div>
  )
}

interface DumpDialogHeaderProps {
  schemaOnly: boolean
  isExporting: boolean
  onClose: () => void
}

export function DumpDialogHeader({ schemaOnly, isExporting, onClose }: DumpDialogHeaderProps) {
  return (
    <div className={styles.header}>
      <h2 className={styles.title}>{dumpDialogTitle(schemaOnly)}</h2>
      {!isExporting && (
        <Button variant="bare" className={styles.closeButton} onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </Button>
      )}
    </div>
  )
}

interface ObjectsToExportFieldProps {
  selectedCount: number
  listProps: DumpObjectListProps
}

export function ObjectsToExportField({ selectedCount, listProps }: ObjectsToExportFieldProps) {
  return (
    <div className={styles.fieldGroup}>
      <span className={styles.label}>Objects to Export{selectionCountSuffix(selectedCount)}</span>
      <DumpObjectList {...listProps} />
    </div>
  )
}

export function DumpErrorMessage({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <div className={styles.error} data-testid="dump-error">
      {error}
    </div>
  )
}
