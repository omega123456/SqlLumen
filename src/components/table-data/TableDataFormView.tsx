/**
 * TableDataFormView — thin wrapper around BaseFormView for the table data browser.
 *
 * Reads from useTableDataStore + useConnectionStore, adapts the rich store
 * state into the shared BaseFormViewProps shape, and delegates all rendering
 * to BaseFormView.  Toast notifications and temporal-validation on save live
 * here (BaseFormView is store-free and toast-free).
 */

import { useCallback, useEffect, useMemo } from 'react'
import { useTableDataStore, isEditingRowKey, isSameRowKey } from '../../stores/table-data-store'
import { useIsConnectionReadOnly } from '../../stores/connection-store'
import { FALLBACK_ROW_LIMIT } from '../../stores/query-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { buildForeignKeyLookup } from '../../lib/foreign-key-utils'
import { BaseFormView } from '../shared/BaseFormView'
import { FkLookupProvider, type FkLookupArgs } from '../shared/fk-lookup-context'
import { BlobViewerTargetDialog, ForeignKeyLookupTargetDialog } from './TableDataCellDialogs'
import { useBlobViewerState } from './use-blob-viewer-state'
import { useFkLookupFlow } from './use-fk-lookup-flow'
import { saveCurrentRowWithFeedback } from './row-save-feedback'
import type {
  GridColumnDescriptor,
  RowEditState as SharedRowEditState,
} from '../../types/shared-data-view'
import type {
  ForeignKeyColumnInfo,
  PrimaryKeyInfo,
  RowEditState,
  TableDataColumnMeta,
  TableDataTabState,
} from '../../types/schema'
import { isUnchangedForeignKeySelection } from '../../lib/foreign-key-utils'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a PK-based row key from a positional row array. */
function getRowKeyFromArray(
  row: unknown[],
  columns: TableDataColumnMeta[],
  primaryKeyColumns: string[]
): Record<string, unknown> {
  const key: Record<string, unknown> = {}
  for (const primaryKeyColumn of primaryKeyColumns) {
    const index = columns.findIndex((column) => column.name === primaryKeyColumn)
    if (index !== -1) {
      key[primaryKeyColumn] = row[index]
    }
  }
  return key
}

/** Build a values map from a positional row array and column metadata. */
function rowToValues(row: unknown[], columns: TableDataColumnMeta[]): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (let columnIndex = 0; columnIndex < columns.length; columnIndex++) {
    values[columns[columnIndex].name] = row[columnIndex]
  }
  return values
}

function escapeForAttributeSelector(value: string): string {
  const canUseCssEscape = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
  if (canUseCssEscape) {
    return CSS.escape(value)
  }
  return value.replace(/(["\\])/g, '\\$1')
}

function focusFormInput(columnName: string): void {
  const input = document.querySelector<HTMLElement>(
    `[data-testid="form-input-${escapeForAttributeSelector(columnName)}"]`
  )
  input?.focus()
}

type RowKey = Record<string, unknown>

const EMPTY_COLUMNS: TableDataColumnMeta[] = []
const EMPTY_ROWS: unknown[][] = []
const EMPTY_KEY_COLUMNS: string[] = []
const EMPTY_FOREIGN_KEYS: ForeignKeyColumnInfo[] = []

interface FormTabView {
  connectionId: string
  columns: TableDataColumnMeta[]
  rows: unknown[][]
  currentPage: number
  pageSize: number
  primaryKey: PrimaryKeyInfo | null
  primaryKeyColumns: string[]
  editState: RowEditState | null
  selectedRowKey: RowKey | null
  isLoading: boolean
  foreignKeys: ForeignKeyColumnInfo[]
}

const EMPTY_FORM_TAB_VIEW: FormTabView = {
  connectionId: '',
  columns: EMPTY_COLUMNS,
  rows: EMPTY_ROWS,
  currentPage: 1,
  pageSize: FALLBACK_ROW_LIMIT,
  primaryKey: null,
  primaryKeyColumns: EMPTY_KEY_COLUMNS,
  editState: null,
  selectedRowKey: null,
  isLoading: false,
  foreignKeys: EMPTY_FOREIGN_KEYS,
}

function formTabView(tabState: TableDataTabState | undefined): FormTabView {
  if (!tabState) return EMPTY_FORM_TAB_VIEW
  return {
    connectionId: tabState.connectionId,
    columns: tabState.columns,
    rows: tabState.rows,
    currentPage: tabState.currentPage,
    pageSize: tabState.pageSize,
    primaryKey: tabState.primaryKey,
    primaryKeyColumns: tabState.primaryKey?.keyColumns ?? EMPTY_KEY_COLUMNS,
    editState: tabState.editState,
    selectedRowKey: tabState.selectedRowKey,
    isLoading: tabState.isLoading,
    foreignKeys: tabState.foreignKeys ?? EMPTY_FOREIGN_KEYS,
  }
}

interface SelectedRowLookup {
  selectedRowKey: RowKey | null
  rows: unknown[][]
  columns: TableDataColumnMeta[]
  primaryKeyColumns: string[]
}

function findSelectedLocalIndex(lookup: SelectedRowLookup): number {
  const { selectedRowKey, rows } = lookup
  if (!selectedRowKey) return 0
  if (rows.length === 0) return 0
  // Handle temp rows (new row insert): selectedRowKey = { __tempId: 'temp-...' }
  // New rows are always appended at the end of the rows array
  if ('__tempId' in selectedRowKey) {
    return rows.length - 1
  }
  const index = rows.findIndex((row) => {
    const key = getRowKeyFromArray(row, lookup.columns, lookup.primaryKeyColumns)
    return isSameRowKey(key, selectedRowKey)
  })
  return Math.max(index, 0)
}

function buildCurrentRowData(
  currentRow: unknown[],
  columns: TableDataColumnMeta[],
  activeEditState: RowEditState | null
): Record<string, unknown> {
  const rowData: Record<string, unknown> = {}
  for (let columnIndex = 0; columnIndex < columns.length; columnIndex++) {
    rowData[columns[columnIndex].name] = currentRow[columnIndex] ?? null
  }

  if (!activeEditState) return rowData

  rowData.__editingRowKey = activeEditState.rowKey
  for (const [columnName, value] of Object.entries(activeEditState.currentValues)) {
    rowData[columnName] = value
  }
  return rowData
}

interface FormEditability {
  isConnectionReadOnly: boolean
  hasPrimaryKey: boolean
  isView: boolean | undefined
}

function canEditFormRows(editability: FormEditability): boolean {
  if (editability.isConnectionReadOnly || editability.isView) return false
  return editability.hasPrimaryKey
}

function isAtFirstRecord(currentPage: number, localIndex: number): boolean {
  return currentPage === 1 && localIndex === 0
}

type StoreRowPicker = (rows: unknown[][]) => unknown[] | undefined

function selectStoreRow(tabId: string, primaryKeyColumns: string[], pickRow: StoreRowPicker): void {
  const updatedState = useTableDataStore.getState().tabs[tabId]
  if (!updatedState) return
  const targetRow = pickRow(updatedState.rows)
  if (!targetRow) return
  const newKey = getRowKeyFromArray(targetRow, updatedState.columns, primaryKeyColumns)
  useTableDataStore.getState().setSelectedRow(tabId, newKey)
}

interface FormRowPosition {
  localIndex: number
  rowCount: number
  currentPage: number
  pageSize: number
}

interface RelativeRowNavigation {
  tabId: string
  direction: -1 | 1
  position: FormRowPosition
  primaryKeyColumns: string[]
  fetchPage: (tabId: string, page: number) => Promise<void>
}

const pickFirstRow: StoreRowPicker = (rows) => rows[0]
const pickLastRow: StoreRowPicker = (rows) => rows[rows.length - 1]

async function navigateToRelativeRow(navigation: RelativeRowNavigation): Promise<void> {
  const { tabId, direction, position, primaryKeyColumns } = navigation
  const isForwardCrossPage = direction > 0 && position.localIndex === position.rowCount - 1
  const isBackwardCrossPage = direction < 0 && position.localIndex === 0 && position.currentPage > 1

  if (isForwardCrossPage) {
    await navigation.fetchPage(tabId, position.currentPage + 1)
    selectStoreRow(tabId, primaryKeyColumns, pickFirstRow)
    return
  }

  if (isBackwardCrossPage) {
    await navigation.fetchPage(tabId, position.currentPage - 1)
    selectStoreRow(tabId, primaryKeyColumns, pickLastRow)
    return
  }

  const absoluteIndex = (position.currentPage - 1) * position.pageSize + position.localIndex
  const newAbsoluteIndex = absoluteIndex + direction
  const newLocalIndex =
    ((newAbsoluteIndex % position.pageSize) + position.pageSize) % position.pageSize
  selectStoreRow(tabId, primaryKeyColumns, (rows) => rows[Math.min(newLocalIndex, rows.length - 1)])
}

// ---------------------------------------------------------------------------
// Column adapter
// ---------------------------------------------------------------------------

/** Convert TableDataColumnMeta[] → GridColumnDescriptor[]. */
function toGridColumns(columns: TableDataColumnMeta[]): GridColumnDescriptor[] {
  return columns.map((column) => ({
    key: column.name,
    displayName: column.name,
    dataType: column.dataType,
    editable: true, // BaseFormView further restricts with hasEditCapability && !isBlobField
    isBinary: column.isBinary,
    isNullable: column.isNullable,
    isPrimaryKey: column.isPrimaryKey,
    isUniqueKey: column.isUniqueKey && !column.isPrimaryKey,
    enumValues: column.enumValues,
    tableColumnMeta: column,
  }))
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface TableDataFormViewProps {
  tabId: string
  isView?: boolean
  isActive?: boolean
}

export function TableDataFormView({ tabId, isView, isActive = true }: TableDataFormViewProps) {
  const tabState = useTableDataStore((state) => state.tabs[tabId])
  const startEditing = useTableDataStore((state) => state.startEditing)
  const updateCellValue = useTableDataStore((state) => state.updateCellValue)
  const saveCurrentRow = useTableDataStore((state) => state.saveCurrentRow)
  const discardCurrentRow = useTableDataStore((state) => state.discardCurrentRow)
  const requestNavigationAction = useTableDataStore((state) => state.requestNavigationAction)
  const fetchPage = useTableDataStore((state) => state.fetchPage)
  const setSelectedRow = useTableDataStore((state) => state.setSelectedRow)
  const setBlockingNavigation = useWorkspaceStore((state) => state.setBlockingNavigation)

  const {
    connectionId,
    columns,
    rows,
    currentPage,
    pageSize,
    primaryKey,
    primaryKeyColumns,
    editState: storeEditState,
    selectedRowKey,
    isLoading,
    foreignKeys,
  } = formTabView(tabState)
  const isConnectionReadOnly = useIsConnectionReadOnly(connectionId)
  const foreignKeyLookup = useMemo(() => buildForeignKeyLookup(foreignKeys), [foreignKeys])

  const { foreignKeyLookupTarget, openForeignKeyLookup, closeForeignKeyLookup } = useFkLookupFlow()
  const isForeignKeyLookupOpen = foreignKeyLookupTarget !== null

  const isEditable = canEditFormRows({
    isConnectionReadOnly: isConnectionReadOnly,
    hasPrimaryKey: primaryKey !== null,
    isView: isView,
  })
  const blobViewer = useBlobViewerState({
    tabId: tabId,
    columns: columns,
    primaryKeyColumns: primaryKeyColumns,
  })

  // --- Grid columns (stable) ---
  const gridColumns = useMemo(
    () =>
      toGridColumns(columns).map((column) => ({
        ...column,
        foreignKey: foreignKeyLookup.get(column.key.toLowerCase()),
      })),
    [columns, foreignKeyLookup]
  )

  // --- Find local index of selected row ---
  const localIndex = useMemo(
    () =>
      findSelectedLocalIndex({
        selectedRowKey: selectedRowKey,
        rows: rows,
        columns: columns,
        primaryKeyColumns: primaryKeyColumns,
      }),
    [selectedRowKey, rows, columns, primaryKeyColumns]
  )

  const absoluteIndex = (currentPage - 1) * pageSize + localIndex
  const currentRow = rows.length > 0 ? rows[localIndex] : null

  // Current row key (for edit-state matching)
  const currentRowKey = useMemo(() => {
    if (storeEditState?.isNewRow) return storeEditState.rowKey
    if (!currentRow) return null
    if (primaryKeyColumns.length === 0) return null
    return getRowKeyFromArray(currentRow, columns, primaryKeyColumns)
  }, [storeEditState, currentRow, columns, primaryKeyColumns])

  // Is the current row being edited?
  const isEditingCurrentRow = useMemo(() => {
    if (!currentRowKey) return false
    return isEditingRowKey(storeEditState, currentRowKey)
  }, [storeEditState, currentRowKey])

  const currentRowData = useMemo(() => {
    if (!currentRow) return null
    const activeEditState = isEditingCurrentRow ? storeEditState : null
    return buildCurrentRowData(currentRow, columns, activeEditState)
  }, [currentRow, columns, storeEditState, isEditingCurrentRow])

  // --- Adapt store RowEditState → shared RowEditState ---
  const sharedEditState: SharedRowEditState | null = useMemo(() => {
    if (!storeEditState) return null
    if (!isEditingCurrentRow) return null
    return {
      rowKey: JSON.stringify(storeEditState.rowKey),
      currentValues: storeEditState.currentValues,
      originalValues: storeEditState.originalValues,
    }
  }, [storeEditState, isEditingCurrentRow])

  // --- Navigation boundary flags ---
  // Fold isLoading into the first flag so BaseFormView disables buttons
  const isFirstRecord = isAtFirstRecord(currentPage, localIndex) || isLoading

  // --- Navigation handlers ---
  const navigateRelative = useCallback(
    (direction: -1 | 1) => {
      if (!tabState) return
      if (isLoading) return

      const isBackwardFromFirstRecord = direction < 0 && isAtFirstRecord(currentPage, localIndex)
      if (isBackwardFromFirstRecord) return

      const action = () =>
        navigateToRelativeRow({
          tabId: tabId,
          direction: direction,
          position: {
            localIndex: localIndex,
            rowCount: rows.length,
            currentPage: currentPage,
            pageSize: pageSize,
          },
          primaryKeyColumns: primaryKeyColumns,
          fetchPage: fetchPage,
        })

      requestNavigationAction(tabId, action)
    },
    [
      tabState,
      isLoading,
      localIndex,
      rows.length,
      currentPage,
      pageSize,
      tabId,
      fetchPage,
      primaryKeyColumns,
      requestNavigationAction,
    ]
  )

  const onNavigatePrevious = useCallback(() => navigateRelative(-1), [navigateRelative])
  const onNavigateNext = useCallback(() => navigateRelative(1), [navigateRelative])

  // --- Editing callbacks ---

  /** Shared logic: if the current row is editable and not already being edited, start editing. */
  const ensureEditingCurrentRow = useCallback(() => {
    if (!isEditable) return
    if (!currentRow) return
    if (!currentRowKey) return
    if (isEditingRowKey(storeEditState, currentRowKey)) return
    const values = rowToValues(currentRow, columns)
    startEditing(tabId, currentRowKey, values)
  }, [isEditable, currentRow, currentRowKey, storeEditState, columns, startEditing, tabId])

  const onEnsureEditing = useCallback(() => {
    ensureEditingCurrentRow()
  }, [ensureEditingCurrentRow])

  const onUpdateCell = useCallback(
    (columnKey: string, value: unknown) => {
      if (!currentRow) return
      if (!currentRowKey) return
      ensureEditingCurrentRow()
      updateCellValue(tabId, columnKey, value)
    },
    [currentRow, currentRowKey, ensureEditingCurrentRow, updateCellValue, tabId]
  )

  const onSave = useCallback(async () => {
    const validationError = await saveCurrentRowWithFeedback({
      tabId: tabId,
      editState: storeEditState,
      columns: columns,
    })
    if (validationError) {
      focusFormInput(validationError.columnName)
    }
  }, [tabId, storeEditState, columns])

  const onDiscard = useCallback(() => {
    discardCurrentRow(tabId)
  }, [discardCurrentRow, tabId])

  const onForeignKeyLookup = useCallback(
    async (args: FkLookupArgs) => {
      if (!isActive) return
      if (!currentRowKey) return

      const isEditingAnotherRow =
        Boolean(storeEditState) && !isEditingRowKey(storeEditState, currentRowKey)
      if (isEditingAnotherRow) {
        await saveCurrentRow(tabId)
        const refreshedState = useTableDataStore.getState().tabs[tabId]
        if (refreshedState?.saveError) return
      }

      setSelectedRow(tabId, currentRowKey)
      openForeignKeyLookup(args)
    },
    [
      isActive,
      currentRowKey,
      storeEditState,
      saveCurrentRow,
      tabId,
      setSelectedRow,
      openForeignKeyLookup,
    ]
  )

  useEffect(() => {
    setBlockingNavigation(tabId, isForeignKeyLookupOpen)
    return () => setBlockingNavigation(tabId, false)
  }, [isForeignKeyLookupOpen, setBlockingNavigation, tabId])

  useEffect(() => {
    if (isActive) return
    queueMicrotask(closeForeignKeyLookup)
  }, [closeForeignKeyLookup, isActive])

  const onForeignKeyApply = useCallback(
    (selectedValue: unknown) => {
      if (!foreignKeyLookupTarget) return
      if (!currentRowKey) return
      if (!currentRowData) return

      const currentEdit = useTableDataStore.getState().tabs[tabId]?.editState
      const alreadyEditing = isEditingRowKey(currentEdit, currentRowKey)
      const isUnchangedSelection = isUnchangedForeignKeySelection({
        selectedValue: selectedValue,
        currentValue: foreignKeyLookupTarget.currentValue,
        rowEditState: alreadyEditing ? currentEdit : null,
      })
      if (isUnchangedSelection) {
        closeForeignKeyLookup()
        return
      }

      if (!alreadyEditing) {
        ensureEditingCurrentRow()
      }

      updateCellValue(tabId, foreignKeyLookupTarget.columnKey, selectedValue)
      useTableDataStore.getState().syncCellValue(tabId, {
        rowData: currentRowData,
        column: foreignKeyLookupTarget.columnKey,
        value: selectedValue,
        rowKeyOverride: currentRowKey,
      })
      closeForeignKeyLookup()
    },
    [
      foreignKeyLookupTarget,
      currentRowKey,
      currentRowData,
      tabId,
      ensureEditingCurrentRow,
      updateCellValue,
      closeForeignKeyLookup,
    ]
  )

  // --- BLOB view/edit ---
  // The viewer can only fetch real bytes when the current row has a resolvable
  // primary key. Without one (read-only connection or PK-less table) the grid
  // holds only the placeholder, so the affordance is disabled rather than
  // opening a dialog that would falsely report the value as NULL.
  const canResolveBlobPrimaryKey = isEditable && primaryKeyColumns.length > 0
  const { openBlobViewer } = blobViewer
  const onBlobView = useCallback(
    (column: GridColumnDescriptor, rowData: Record<string, unknown> | null) => {
      if (!rowData) return
      if (!canResolveBlobPrimaryKey) return
      openBlobViewer(column.key, rowData)
    },
    [canResolveBlobPrimaryKey, openBlobViewer]
  )

  // --- Render ---
  return (
    <FkLookupProvider onFkLookup={onForeignKeyLookup}>
      <BaseFormView
        columns={gridColumns}
        currentRow={currentRow}
        currentRowData={currentRowData}
        recordCountMode="unknown"
        currentAbsoluteIndex={absoluteIndex}
        isFirstRecord={isFirstRecord}
        onNavigatePrev={onNavigatePrevious}
        onNavigateNext={onNavigateNext}
        isLoading={isLoading}
        editState={sharedEditState}
        onEnsureEditing={onEnsureEditing}
        onUpdateCell={onUpdateCell}
        onSave={isEditable ? onSave : undefined}
        onDiscard={isEditable ? onDiscard : undefined}
        readOnly={!isEditable}
        testId="table-data-form-view"
        workspaceTabId={tabId}
        onBlobView={onBlobView}
        blobViewDisabled={!canResolveBlobPrimaryKey}
        blobViewDisabledReason="Cannot view BLOB — table has no primary key"
      />
      {foreignKeyLookupTarget && tabState && (
        <ForeignKeyLookupTargetDialog
          target={foreignKeyLookupTarget}
          tableLocation={tabState}
          isReadOnly={!isEditable}
          onClose={closeForeignKeyLookup}
          onApply={onForeignKeyApply}
        />
      )}
      <BlobViewerTargetDialog viewer={blobViewer} />
    </FkLookupProvider>
  )
}
