import { Link, Trash } from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { logFrontendError } from '../../lib/app-log-commands'
import { listColumns, listDatabases, listSchemaObjects } from '../../lib/schema-commands'
import {
  useTableDesignerStore,
  type TableDesignerStore,
  type TableDesignerTabState,
} from '../../stores/table-designer-store'
import type { TableDesignerColumnDef, TableDesignerForeignKeyDef } from '../../types/schema'
import { Button } from '../common/Button'
import { Dropdown, type DropdownOption } from '../common/Dropdown'
import { TextInput } from '../common/TextInput'
import styles from './ForeignKeyEditor.module.css'
import { isEven } from '../../lib/units'
import { isBlank } from '../../lib/value-checks'

interface ForeignKeyEditorProps {
  tabId: string
}

const ACTION_OPTIONS = ['NO ACTION', 'CASCADE', 'SET NULL', 'RESTRICT']

const ACTION_DROPDOWN_OPTIONS: DropdownOption[] = ACTION_OPTIONS.map((action) => ({
  value: action,
  label: action,
}))

function makeReferencedTargetKey(database: string, table: string): string {
  return `${database}\u0000${table}`
}

const EMPTY_COLUMNS: TableDesignerColumnDef[] = []
const EMPTY_FOREIGN_KEYS: TableDesignerForeignKeyDef[] = []
const EMPTY_TEXT_FALLBACK = '—'

interface ForeignKeyEditorSource {
  columns: TableDesignerColumnDef[]
  foreignKeys: TableDesignerForeignKeyDef[]
  connectionId: string | undefined
  databaseName: string | undefined
}

function foreignKeyEditorSource(
  tabState: TableDesignerTabState | undefined
): ForeignKeyEditorSource {
  if (!tabState) {
    return {
      columns: EMPTY_COLUMNS,
      foreignKeys: EMPTY_FOREIGN_KEYS,
      connectionId: undefined,
      databaseName: undefined,
    }
  }
  return {
    columns: tabState.currentSchema.columns,
    foreignKeys: tabState.currentSchema.foreignKeys,
    connectionId: tabState.connectionId,
    databaseName: tabState.databaseName,
  }
}

function resolveEffectiveSelectedRow(selectedRow: number | null, rowCount: number): number | null {
  if (selectedRow === null) return null
  if (selectedRow >= rowCount) return null
  return selectedRow
}

function canDeleteForeignKeyAt(
  foreignKeys: TableDesignerForeignKeyDef[],
  index: number | null
): boolean {
  if (index === null) return false
  if (index >= foreignKeys.length) return false
  return !foreignKeys[index]?.isComposite
}

function selectionAfterDelete(current: number | null, deletedIndex: number): number | null {
  if (current === null) {
    return null
  }

  if (current === deletedIndex) {
    return deletedIndex > 0 ? deletedIndex - 1 : null
  }

  if (current > deletedIndex) {
    return current - 1
  }

  return current
}

function rowStripeClassName(isSelected: boolean, index: number): string {
  if (isSelected) return styles.selectedRow
  return isEven(index) ? styles.evenRow : styles.oddRow
}

function cellInputClassName(isSelected: boolean): string {
  return isSelected ? styles.activeInput : styles.inactiveInput
}

function cellSelectClassName(isSelected: boolean): string {
  return `${styles.cellSelect} ${cellInputClassName(isSelected)}`
}

function referencedTargetKeyFor(referencedDatabase: string, referencedTable: string): string {
  if (referencedDatabase === '') return ''
  if (referencedTable === '') return ''
  return makeReferencedTargetKey(referencedDatabase, referencedTable)
}

function stopRowSelection(event: React.MouseEvent): void {
  event.stopPropagation()
}

interface ReferencedLookups {
  tablesByDatabase: Record<string, string[]>
  loadingTablesByDatabase: Record<string, boolean>
  columnsByTarget: Record<string, string[]>
  loadingColumnsByTarget: Record<string, boolean>
}

interface ForeignKeyRowContext {
  tabId: string
  databaseName: string | undefined
  sourceColumnOptions: DropdownOption[]
  databaseOptions: DropdownOption[]
  referencedLookups: ReferencedLookups
  updateForeignKey: TableDesignerStore['updateForeignKey']
  onSelect: (index: number) => void
  onDelete: (index: number) => void
}

interface ForeignKeyRowPosition {
  index: number
  isSelected: boolean
}

interface ForeignKeyRowProps {
  foreignKey: TableDesignerForeignKeyDef
  position: ForeignKeyRowPosition
  context: ForeignKeyRowContext
}

function ForeignKeyRow({ foreignKey, position, context }: ForeignKeyRowProps) {
  const rowClassName = `${styles.row} ${rowStripeClassName(position.isSelected, position.index)}`
  return (
    <tr
      className={rowClassName}
      data-testid={`fk-row-${position.index}`}
      onClick={() => context.onSelect(position.index)}
    >
      <td className={`${styles.bodyCell} ${styles.indicatorCell}`}>
        <span className={styles.rowAccent} aria-hidden />
      </td>
      <td className={`${styles.bodyCell} ${styles.rowNumberCell}`}>{position.index + 1}</td>
      {foreignKey.isComposite ? (
        <CompositeForeignKeyCells
          foreignKey={foreignKey}
          index={position.index}
          databaseName={context.databaseName}
        />
      ) : (
        <EditableForeignKeyCells foreignKey={foreignKey} position={position} context={context} />
      )}
    </tr>
  )
}

interface CompositeForeignKeyCellsProps {
  foreignKey: TableDesignerForeignKeyDef
  index: number
  databaseName: string | undefined
}

function CompositeForeignKeyCells({
  foreignKey,
  index,
  databaseName,
}: CompositeForeignKeyCellsProps) {
  const referencedDatabase = foreignKey.referencedDatabase || databaseName || EMPTY_TEXT_FALLBACK
  return (
    <>
      <td className={styles.bodyCell}>
        <span className={styles.readonlyText}>{foreignKey.name || EMPTY_TEXT_FALLBACK}</span>
      </td>
      <td className={styles.bodyCell} colSpan={5}>
        <div className={styles.compositeCell} data-testid={`fk-composite-badge-${index}`}>
          <span className={styles.warningBadge}>Multi-column — view only</span>
          <div className={styles.compositeSummary}>
            <span>{foreignKey.sourceColumn || EMPTY_TEXT_FALLBACK}</span>
            <span>→</span>
            <span>
              {referencedDatabase}.{foreignKey.referencedTable || EMPTY_TEXT_FALLBACK}.
              {foreignKey.referencedColumn || EMPTY_TEXT_FALLBACK}
            </span>
          </div>
        </div>
      </td>
      <td className={styles.bodyCell}>
        <span className={styles.readonlyText}>{foreignKey.onDelete || EMPTY_TEXT_FALLBACK}</span>
      </td>
      <td className={styles.bodyCell}>
        <span className={styles.readonlyText}>{foreignKey.onUpdate || EMPTY_TEXT_FALLBACK}</span>
      </td>
      <td className={`${styles.bodyCell} ${styles.deleteCell}`} />
    </>
  )
}

function referencedTableOptionsFor(
  lookups: ReferencedLookups,
  referencedDatabase: string
): DropdownOption[] {
  const isLoading = lookups.loadingTablesByDatabase[referencedDatabase]
  const tableNames = lookups.tablesByDatabase[referencedDatabase] ?? []
  return [
    { value: '', label: isLoading ? 'Loading tables...' : 'Select table' },
    ...tableNames.map((tableName) => ({ value: tableName, label: tableName })),
  ]
}

function referencedColumnNamesFor(lookups: ReferencedLookups, targetKey: string): string[] {
  if (targetKey === '') return []
  return lookups.columnsByTarget[targetKey] ?? []
}

function isReferencedColumnLoadingFor(lookups: ReferencedLookups, targetKey: string): boolean {
  return Boolean(targetKey && lookups.loadingColumnsByTarget[targetKey])
}

interface ReferencedColumnCellProps {
  foreignKey: TableDesignerForeignKeyDef
  position: ForeignKeyRowPosition
  context: ForeignKeyRowContext
  referencedDatabase: string
}

function ReferencedColumnCell({
  foreignKey,
  position,
  context,
  referencedDatabase,
}: ReferencedColumnCellProps) {
  const { tabId, updateForeignKey, referencedLookups } = context
  const { index, isSelected } = position
  const targetKey = referencedTargetKeyFor(referencedDatabase, foreignKey.referencedTable)
  const columnNames = referencedColumnNamesFor(referencedLookups, targetKey)
  const isLoading = isReferencedColumnLoadingFor(referencedLookups, targetKey)
  const updateReferencedColumn = (value: string) =>
    updateForeignKey(tabId, { index: index, field: 'referencedColumn', value: value })
  const hasColumnChoices = foreignKey.referencedTable !== '' && columnNames.length > 0

  if (!hasColumnChoices) {
    return (
      <TextInput
        type="text"
        variant="tableCell"
        value={foreignKey.referencedColumn}
        placeholder="column name"
        className={cellInputClassName(isSelected)}
        data-testid={`fk-referenced-column-${index}`}
        onClick={stopRowSelection}
        onChange={(event) => updateReferencedColumn(event.target.value)}
      />
    )
  }

  return (
    <div onClick={stopRowSelection}>
      <Dropdown
        id={`fk-referenced-column-${tabId}-${index}`}
        ariaLabel="Referenced column"
        options={[
          { value: '', label: isLoading ? 'Loading columns...' : 'Select column' },
          ...columnNames.map((columnName) => ({ value: columnName, label: columnName })),
        ]}
        value={foreignKey.referencedColumn}
        data-testid={`fk-referenced-column-${index}`}
        onChange={updateReferencedColumn}
        workspaceTabId={tabId}
        triggerClassName={cellSelectClassName(isSelected)}
      />
    </div>
  )
}

interface EditableForeignKeyCellsProps {
  foreignKey: TableDesignerForeignKeyDef
  position: ForeignKeyRowPosition
  context: ForeignKeyRowContext
}

function EditableForeignKeyCells({ foreignKey, position, context }: EditableForeignKeyCellsProps) {
  const { tabId, updateForeignKey } = context
  const { index, isSelected } = position
  const referencedDatabase = foreignKey.referencedDatabase || context.databaseName || ''
  const update = (field: keyof TableDesignerForeignKeyDef, value: unknown) =>
    updateForeignKey(tabId, { index: index, field: field, value: value })

  return (
    <>
      <td className={styles.bodyCell}>
        <TextInput
          type="text"
          variant="tableCell"
          value={foreignKey.name}
          className={cellInputClassName(isSelected)}
          data-testid={`fk-name-${index}`}
          onClick={stopRowSelection}
          onChange={(event) => update('name', event.target.value)}
        />
      </td>
      <td className={styles.bodyCell}>
        <div onClick={stopRowSelection}>
          <Dropdown
            id={`fk-source-column-${tabId}-${index}`}
            ariaLabel="Source column"
            options={context.sourceColumnOptions}
            value={foreignKey.sourceColumn}
            data-testid={`fk-source-column-${index}`}
            onChange={(value) => update('sourceColumn', value)}
            workspaceTabId={tabId}
            triggerClassName={cellSelectClassName(isSelected)}
          />
        </div>
      </td>
      <td className={styles.bodyCell}>
        <div onClick={stopRowSelection}>
          <Dropdown
            id={`fk-referenced-database-${tabId}-${index}`}
            ariaLabel="Referenced database"
            options={context.databaseOptions}
            value={referencedDatabase}
            data-testid={`fk-referenced-database-${index}`}
            onChange={(value) => {
              update('referencedDatabase', value)
              update('referencedTable', '')
              update('referencedColumn', '')
            }}
            workspaceTabId={tabId}
            triggerClassName={cellSelectClassName(isSelected)}
          />
        </div>
      </td>
      <td className={styles.bodyCell}>
        <div onClick={stopRowSelection}>
          <Dropdown
            id={`fk-referenced-table-${tabId}-${index}`}
            ariaLabel="Referenced table"
            options={referencedTableOptionsFor(context.referencedLookups, referencedDatabase)}
            value={foreignKey.referencedTable}
            data-testid={`fk-referenced-table-${index}`}
            onChange={(value) => {
              update('referencedTable', value)
              update('referencedColumn', '')
            }}
            workspaceTabId={tabId}
            triggerClassName={cellSelectClassName(isSelected)}
            disabled={referencedDatabase === ''}
          />
        </div>
      </td>
      <td className={styles.bodyCell}>
        <ReferencedColumnCell
          foreignKey={foreignKey}
          position={position}
          context={context}
          referencedDatabase={referencedDatabase}
        />
      </td>
      <td className={styles.bodyCell}>
        <div onClick={stopRowSelection}>
          <Dropdown
            id={`fk-on-delete-${tabId}-${index}`}
            ariaLabel="On delete"
            options={ACTION_DROPDOWN_OPTIONS}
            value={foreignKey.onDelete}
            data-testid={`fk-on-delete-${index}`}
            onChange={(value) => update('onDelete', value)}
            workspaceTabId={tabId}
            triggerClassName={cellSelectClassName(isSelected)}
          />
        </div>
      </td>
      <td className={styles.bodyCell}>
        <div onClick={stopRowSelection}>
          <Dropdown
            id={`fk-on-update-${tabId}-${index}`}
            ariaLabel="On update"
            options={ACTION_DROPDOWN_OPTIONS}
            value={foreignKey.onUpdate}
            data-testid={`fk-on-update-${index}`}
            onChange={(value) => update('onUpdate', value)}
            workspaceTabId={tabId}
            triggerClassName={cellSelectClassName(isSelected)}
          />
        </div>
      </td>
      <td className={`${styles.bodyCell} ${styles.deleteCell}`}>
        <Button
          variant="subtle"
          size="sm"
          dangerText
          iconOnly
          aria-label={`Delete foreign key ${foreignKey.name || index + 1}`}
          data-testid={`fk-delete-${index}`}
          onClick={(event) => {
            event.stopPropagation()
            context.onDelete(index)
          }}
        >
          <Trash size={14} weight="bold" />
        </Button>
      </td>
    </>
  )
}

export function ForeignKeyEditor({ tabId }: ForeignKeyEditorProps) {
  const tabState = useTableDesignerStore((state) => state.tabs[tabId])
  const addForeignKey = useTableDesignerStore((state) => state.addForeignKey)
  const deleteForeignKey = useTableDesignerStore((state) => state.deleteForeignKey)
  const updateForeignKey = useTableDesignerStore((state) => state.updateForeignKey)

  const [selectedRow, setSelectedRow] = useState<number | null>(null)
  const [availableDatabases, setAvailableDatabases] = useState<string[]>([])
  const [isDatabasesLoading, setIsDatabasesLoading] = useState(false)
  const [referencedTablesByDatabase, setReferencedTablesByDatabase] = useState<
    Record<string, string[]>
  >({})
  const [loadingTablesByDatabase, setLoadingTablesByDatabase] = useState<Record<string, boolean>>(
    {}
  )
  const [referencedColumnsByTarget, setReferencedColumnsByTarget] = useState<
    Record<string, string[]>
  >({})
  const [loadingColumnsByTarget, setLoadingColumnsByTarget] = useState<Record<string, boolean>>({})

  const loadedTablesRef = useRef<Set<string>>(new Set())
  const loadingTablesRef = useRef<Set<string>>(new Set())
  const loadedTableColumnsRef = useRef<Set<string>>(new Set())
  const loadingTableColumnsRef = useRef<Set<string>>(new Set())

  const { columns, foreignKeys, connectionId, databaseName } = foreignKeyEditorSource(tabState)
  const columnNames = useMemo(
    () => columns.map((column) => column.name).filter((name) => !isBlank(name)),
    [columns]
  )

  const sourceColumnOptions: DropdownOption[] = useMemo(
    () => [
      { value: '', label: 'Select column' },
      ...columnNames.map((name) => ({ value: name, label: name })),
    ],
    [columnNames]
  )

  const databaseOptions: DropdownOption[] = useMemo(() => {
    const placeholder: DropdownOption = {
      value: '',
      label: isDatabasesLoading ? 'Loading databases...' : 'Select database',
    }

    const databases = new Set(availableDatabases)
    if (databaseName) {
      databases.add(databaseName)
    }

    return [placeholder, ...Array.from(databases).map((name) => ({ value: name, label: name }))]
  }, [availableDatabases, databaseName, isDatabasesLoading])

  useEffect(() => {
    if (!connectionId) return
    if (!databaseName) return

    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) {
        setIsDatabasesLoading(true)
      }
    })

    void listDatabases(connectionId)
      .then((databases) => {
        if (!cancelled) {
          setAvailableDatabases(
            databases.includes(databaseName) ? databases : [databaseName, ...databases]
          )
        }
      })
      .catch((error) => {
        logFrontendError('[foreign-key-editor] Failed to load referenced databases', error)
        if (!cancelled) {
          setAvailableDatabases(databaseName ? [databaseName] : [])
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsDatabasesLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [connectionId, databaseName])

  useEffect(() => {
    loadedTablesRef.current = new Set()
    loadingTablesRef.current = new Set()
    loadedTableColumnsRef.current = new Set()
    loadingTableColumnsRef.current = new Set()
    queueMicrotask(() => {
      setReferencedTablesByDatabase({})
      setLoadingTablesByDatabase({})
      setReferencedColumnsByTarget({})
      setLoadingColumnsByTarget({})
    })
  }, [connectionId, databaseName])

  useEffect(() => {
    if (!connectionId) return
    if (!databaseName) return

    const referencedDatabases = Array.from(
      new Set(
        foreignKeys
          .map((foreignKey) => (foreignKey.referencedDatabase || databaseName).trim())
          .filter((referencedDatabase) => referencedDatabase !== '')
      )
    )

    referencedDatabases.forEach((referencedDatabase) => {
      const isTableListRequested =
        loadedTablesRef.current.has(referencedDatabase) ||
        loadingTablesRef.current.has(referencedDatabase)
      if (isTableListRequested) {
        return
      }

      loadingTablesRef.current.add(referencedDatabase)
      setLoadingTablesByDatabase((current) => ({
        ...current,
        [referencedDatabase]: true,
      }))

      void listSchemaObjects(connectionId, referencedDatabase, 'table')
        .then((tables) => {
          loadedTablesRef.current.add(referencedDatabase)
          setReferencedTablesByDatabase((current) => ({
            ...current,
            [referencedDatabase]: tables,
          }))
        })
        .catch((error) => {
          logFrontendError('[foreign-key-editor] Failed to load referenced tables', error)
          setReferencedTablesByDatabase((current) => ({
            ...current,
            [referencedDatabase]: [],
          }))
        })
        .finally(() => {
          loadingTablesRef.current.delete(referencedDatabase)
          setLoadingTablesByDatabase((current) => ({
            ...current,
            [referencedDatabase]: false,
          }))
        })
    })
  }, [connectionId, databaseName, foreignKeys])

  useEffect(() => {
    if (!connectionId) return
    if (!databaseName) return

    const referencedTargets = Array.from(
      new Set(
        foreignKeys
          .map((foreignKey) =>
            referencedTargetKeyFor(
              (foreignKey.referencedDatabase || databaseName).trim(),
              foreignKey.referencedTable.trim()
            )
          )
          .filter((targetKey) => targetKey !== '')
      )
    )

    referencedTargets.forEach((targetKey) => {
      const isColumnListRequested =
        loadedTableColumnsRef.current.has(targetKey) ||
        loadingTableColumnsRef.current.has(targetKey)
      if (isColumnListRequested) {
        return
      }

      const [referencedDatabase, referencedTable] = targetKey.split('\u0000')
      if (!referencedDatabase) return
      if (!referencedTable) return

      loadingTableColumnsRef.current.add(targetKey)
      setLoadingColumnsByTarget((current) => ({
        ...current,
        [targetKey]: true,
      }))

      void listColumns(connectionId, referencedDatabase, referencedTable)
        .then((loadedColumns) => {
          loadedTableColumnsRef.current.add(targetKey)
          setReferencedColumnsByTarget((current) => ({
            ...current,
            [targetKey]: loadedColumns.map((column) => column.name),
          }))
        })
        .catch((error) => {
          logFrontendError('[foreign-key-editor] Failed to load referenced columns', error)
          setReferencedColumnsByTarget((current) => ({
            ...current,
            [targetKey]: [],
          }))
        })
        .finally(() => {
          loadingTableColumnsRef.current.delete(targetKey)
          setLoadingColumnsByTarget((current) => ({
            ...current,
            [targetKey]: false,
          }))
        })
    })
  }, [connectionId, databaseName, foreignKeys])

  const effectiveSelectedRow = resolveEffectiveSelectedRow(selectedRow, foreignKeys.length)

  if (!tabState) {
    return null
  }

  const canDeleteSelected = canDeleteForeignKeyAt(foreignKeys, effectiveSelectedRow)

  const handleDelete = (foreignKeyIndex: number) => {
    deleteForeignKey(tabId, foreignKeyIndex)
    setSelectedRow((current) => selectionAfterDelete(current, foreignKeyIndex))
  }

  const rowContext: ForeignKeyRowContext = {
    tabId: tabId,
    databaseName: databaseName,
    sourceColumnOptions: sourceColumnOptions,
    databaseOptions: databaseOptions,
    referencedLookups: {
      tablesByDatabase: referencedTablesByDatabase,
      loadingTablesByDatabase: loadingTablesByDatabase,
      columnsByTarget: referencedColumnsByTarget,
      loadingColumnsByTarget: loadingColumnsByTarget,
    },
    updateForeignKey: updateForeignKey,
    onSelect: setSelectedRow,
    onDelete: handleDelete,
  }

  return (
    <div className={styles.container} data-testid="foreign-key-editor">
      <div className={styles.toolbar}>
        <Button
          size="sm"
          onClick={() => {
            addForeignKey(tabId)
            setSelectedRow(foreignKeys.length)
          }}
          data-testid="foreign-key-editor-add"
        >
          <Link size={16} weight="regular" />
          <span>Add FK</span>
        </Button>
        <span className={styles.toolbarDivider} aria-hidden />
        <Button
          variant="subtle"
          size="sm"
          dangerText
          onClick={() => {
            if (effectiveSelectedRow !== null) {
              handleDelete(effectiveSelectedRow)
            }
          }}
          disabled={!canDeleteSelected}
          data-testid="foreign-key-editor-delete-selected"
        >
          <Trash size={16} weight="regular" />
          <span>Delete selected</span>
        </Button>
      </div>

      <div className={styles.gridCard}>
        <div className={styles.tableScroller}>
          <table className={styles.table}>
            <thead className={styles.tableHead}>
              <tr>
                {[
                  '',
                  '#',
                  'FK name',
                  'Source column',
                  'Referenced DB',
                  'Referenced table',
                  'Referenced column',
                  'On delete',
                  'On update',
                  '',
                ].map((label, index) => (
                  <th key={`${label}-${index}`} className={styles.headerCell} scope="col">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className={styles.tableBody}>
              {foreignKeys.map((foreignKey, foreignKeyIndex) => (
                <ForeignKeyRow
                  key={`fk-${foreignKeyIndex}`}
                  foreignKey={foreignKey}
                  position={{
                    index: foreignKeyIndex,
                    isSelected: effectiveSelectedRow === foreignKeyIndex,
                  }}
                  context={rowContext}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
