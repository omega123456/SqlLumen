/**
 * TableDataGrid — thin wrapper around BaseGridView for editable table data.
 *
 * Reads tab state from useTableDataStore, transforms it into BaseGridView
 * props (GridColumnDescriptor[], Record<string, unknown>[] rows), and
 * implements the cell-click guard pattern for async edit validation.
 *
 * Store-specific logic (toast notifications, edit-state tracking, sort
 * dispatch) lives here — BaseGridView stays store-agnostic.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CanvasBaseGridView } from '../shared/glide/CanvasBaseGridView'
import type { GridHandle } from '../shared/glide/glide-grid-types'
import {
  EditorCallbacksContext,
  type EditorCallbacksContextType,
} from '../shared/editor-callbacks-context'
import { FkLookupProvider, type FkLookupArgs } from '../shared/fk-lookup-context'
import { BlobViewerTargetDialog, ForeignKeyLookupTargetDialog } from './TableDataCellDialogs'
import { useBlobViewerState } from './use-blob-viewer-state'
import { useFkLookupFlow } from './use-fk-lookup-flow'
import { reportInvalidTemporalValue } from './row-save-feedback'
import {
  useTableDataStore,
  isSameRowKey,
  findRowIndexByKey as findStoreRowIndexByKey,
  getRowKeyFromData,
} from '../../stores/table-data-store'
import { useToastStore } from '../../stores/toast-store'
import {
  AUTO_SIZE_SAMPLE_LIMIT,
  DEFAULT_COLUMN_WIDTH_PX,
  HEADER_ICON_WIDTH_PX,
  getAutoSizedColumnWidth,
} from '../../lib/grid-column-style'
import type {
  GridColumnDescriptor,
  RowEditState as SharedRowEditState,
  CellClickGuardArgs,
  CellClickGuardResult,
  CellClipboardEditArgs,
  AutoSizeConfig,
} from '../../types/shared-data-view'
import type { TableDataColumnMeta } from '../../types/schema'
import { buildColumnDescriptors } from './table-data-grid-columns'

const FOREIGN_KEY_SHORTCUT_COOLDOWN_MS = 250

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TableDataRow = Record<string, unknown>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRowKey(
  data: Record<string, unknown>,
  primaryKeyColumns: string[]
): Record<string, unknown> {
  return getRowKeyFromData(data, primaryKeyColumns, { includeRowIndexFallback: true })
}

function findRowIndexByKey(
  rows: Record<string, unknown>[],
  targetKey: Record<string, unknown>,
  primaryKeyColumns: string[]
): number {
  return rows.findIndex((row) => isSameRowKey(getRowKey(row, primaryKeyColumns), targetKey))
}

type RowKey = Record<string, unknown>
type TableDataTabState = NonNullable<ReturnType<typeof useTableDataStore.getState>['tabs'][string]>
type TableEditState = TableDataTabState['editState']

interface TableDataGridView {
  columns: TableDataColumnMeta[]
  rows: unknown[][]
  primaryKey: TableDataTabState['primaryKey']
  editState: TableEditState
  sort: TableDataTabState['sort']
  selectedRowKey: RowKey | null
  selectedCell: TableDataTabState['selectedCell']
  foreignKeys: NonNullable<TableDataTabState['foreignKeys']>
  columnWidths: Record<string, number>
  checkedRowCount: number
  scrollRow: number
  scrollCol: number
}

const EMPTY_GRID_VIEW: TableDataGridView = {
  columns: [],
  rows: [],
  primaryKey: null,
  editState: null,
  sort: null,
  selectedRowKey: null,
  selectedCell: null,
  foreignKeys: [],
  columnWidths: {},
  checkedRowCount: 0,
  scrollRow: 0,
  scrollCol: 0,
}

function readGridTabView(tabState: TableDataTabState | undefined): TableDataGridView {
  if (!tabState) return EMPTY_GRID_VIEW
  return {
    columns: tabState.columns,
    rows: tabState.rows,
    primaryKey: tabState.primaryKey,
    editState: tabState.editState,
    sort: tabState.sort,
    selectedRowKey: tabState.selectedRowKey,
    selectedCell: tabState.selectedCell,
    foreignKeys: tabState.foreignKeys ?? EMPTY_GRID_VIEW.foreignKeys,
    columnWidths: tabState.columnWidths ?? EMPTY_GRID_VIEW.columnWidths,
    checkedRowCount: tabState.checkedRowKeys?.length ?? 0,
    scrollRow: tabState.scrollRow,
    scrollCol: tabState.scrollCol,
  }
}

function draftTempIdOf(rowKey: RowKey | null): unknown {
  if (!rowKey || !('__tempId' in rowKey)) return null
  return rowKey.__tempId
}

function editingRowClasses(editState: TableEditState, rowKey: RowKey): string[] {
  if (!editState || !isSameRowKey(rowKey, editState.rowKey)) return []
  if (editState.isNewRow) return ['grid-editing-row', 'grid-new-row']
  return ['grid-editing-row']
}

function isDraftRowIndex(editState: TableEditState, rowIndex: number, rowCount: number): boolean {
  const hasDraftTempId = editState?.isNewRow === true && Boolean(editState.tempId)
  return hasDraftTempId && rowIndex === rowCount - 1
}

interface TableDataRowSource {
  rows: unknown[][]
  columns: TableDataColumnMeta[]
  primaryKeyColumns: string[]
  editState: TableEditState
}

function buildTableDataRow(source: TableDataRowSource, rowIndex: number): TableDataRow {
  const { rows, columns, editState } = source
  const row = rows[rowIndex]
  const object: TableDataRow = { __rowIndex: rowIndex }
  columns.forEach((column, columnIndex) => {
    object[column.name] = row[columnIndex] ?? null
  })
  if (isDraftRowIndex(editState, rowIndex, rows.length)) {
    object.__tempId = editState?.tempId
  }
  if (!editState) return object
  const rowKey = getRowKey(object, source.primaryKeyColumns)
  if (!isSameRowKey(rowKey, editState.rowKey)) return object
  object.__editingRowKey = editState.rowKey
  for (const [columnName, value] of Object.entries(editState.currentValues)) {
    object[columnName] = value
  }
  return object
}

function resolveRestoreRowIndex(
  currentState: TableDataTabState | undefined,
  fallbackRowIndex: number
): number {
  const editState = currentState?.editState
  if (!currentState || !editState) return fallbackRowIndex
  if ('__tempId' in editState.rowKey) return Math.max(0, currentState.rows.length - 1)
  const matchedRowIndex = findStoreRowIndexByKey(
    currentState.rows,
    currentState.columns,
    editState.rowKey
  )
  return matchedRowIndex >= 0 ? matchedRowIndex : fallbackRowIndex
}

function gridSortProps(sort: TableDataTabState['sort']) {
  if (!sort) return { sortColumn: null, sortDirection: null }
  return {
    sortColumn: sort.column,
    sortDirection: sort.direction.toUpperCase() as 'ASC' | 'DESC',
  }
}

function draftScrollRowIndex(editState: TableEditState, rowCount: number): number | null {
  return editState?.isNewRow ? rowCount - 1 : null
}

function isPointerOrUnknownSource(source: CellClickGuardArgs['source']): boolean {
  return !source || source === 'grid-pointer'
}

// ---------------------------------------------------------------------------
// TableDataGrid component
// ---------------------------------------------------------------------------

interface TableDataGridProps {
  tabId: string
  isReadOnly: boolean
  isActive?: boolean
}

export function TableDataGrid({ tabId, isReadOnly, isActive = true }: TableDataGridProps) {
  const gridRef = useRef<GridHandle | null>(null)

  // ---------------------------------------------------------------------------
  // Store subscriptions
  // ---------------------------------------------------------------------------

  const tabState = useTableDataStore((state) => state.tabs[tabId])
  const startEditing = useTableDataStore((state) => state.startEditing)
  const commitEditingRowIfNeeded = useTableDataStore((state) => state.commitEditingRowIfNeeded)
  const setSelectedRow = useTableDataStore((state) => state.setSelectedRow)
  const setCheckedRowKeys = useTableDataStore((state) => state.setCheckedRowKeys)
  const requestNavigationAction = useTableDataStore((state) => state.requestNavigationAction)
  const sortByColumn = useTableDataStore((state) => state.sortByColumn)
  const clearEditStateIfUnmodified = useTableDataStore((state) => state.clearEditStateIfUnmodified)
  const storeUpdateCellValue = useTableDataStore((state) => state.updateCellValue)
  const setSelectedCell = useTableDataStore((state) => state.setSelectedCell)
  const columnJumpRequest = useTableDataStore((state) => state.columnJumpRequests[tabId])
  const highlightedColumnKey = useTableDataStore(
    (state) => state.highlightedColumnByTab[tabId] ?? undefined
  )
  const consumeColumnJump = useTableDataStore((state) => state.consumeColumnJump)
  const clearColumnHighlight = useTableDataStore((state) => state.clearColumnHighlight)
  const setScrollCell = useTableDataStore((state) => state.setScrollCell)
  const setColumnWidth = useTableDataStore((state) => state.setColumnWidth)
  const showError = useToastStore((state) => state.showError)
  const showSuccess = useToastStore((state) => state.showSuccess)

  const view = readGridTabView(tabState)
  const { columns, rows, primaryKey, editState, sort, selectedRowKey, foreignKeys, columnWidths } =
    view
  const primaryKeyColumns = useMemo(() => primaryKey?.keyColumns ?? [], [primaryKey?.keyColumns])
  const hasPrimaryKey = primaryKey !== null
  const canEditRows = !isReadOnly && hasPrimaryKey

  // ---------------------------------------------------------------------------
  // Scroll to newly inserted row at the bottom
  // ---------------------------------------------------------------------------
  const autoSelectedDraftTempIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!editState?.isNewRow) {
      autoSelectedDraftTempIdRef.current = null
      return
    }
    const isDraftSelected = draftTempIdOf(selectedRowKey) === editState.tempId
    if (!isDraftSelected || rows.length === 0) return
    if (autoSelectedDraftTempIdRef.current === editState.tempId) return
    const draftRowIndex = rows.length - 1
    autoSelectedDraftTempIdRef.current = editState.tempId ?? null
    requestAnimationFrame(() => {
      gridRef.current?.selectCell({ rowIdx: draftRowIndex, idx: 0 }, { shouldFocusCell: true })
    })
  }, [editState?.isNewRow, editState?.tempId, rows.length, selectedRowKey])

  // ---------------------------------------------------------------------------
  // Scroll position: save on scroll, restore on mount/tab-switch
  // ---------------------------------------------------------------------------
  const handleScrollCellChange = useCallback(
    (scrollRow: number, scrollColumn: number) => {
      setScrollCell(tabId, scrollRow, scrollColumn)
    },
    [setScrollCell, tabId]
  )

  const handleColumnResize = useCallback(
    (columnKey: string, width: number) => {
      setColumnWidth(tabId, columnKey, width)
    },
    [setColumnWidth, tabId]
  )

  // ---------------------------------------------------------------------------
  // Multi-select checkbox column — track checked rows as row keys so toolbar
  // actions can target them. Unsaved draft rows carry __tempId in their key.
  // ---------------------------------------------------------------------------
  const handleRowMarkersChange = useCallback(
    (selectedRows: Record<string, unknown>[]) => {
      const keys = selectedRows.map((row) => {
        if (row.__tempId) return { __tempId: row.__tempId }
        return getRowKey(row, primaryKeyColumns)
      })
      setCheckedRowKeys(tabId, keys)
    },
    [primaryKeyColumns, setCheckedRowKeys, tabId]
  )

  // When the store's checked set transitions from non-empty to empty (e.g. the
  // toolbar cleared it after a bulk delete), push a reset signal down to the
  // grid so its internal CompactSelection.rows checkmarks are cleared too.
  // Uses the documented "adjust state during render" pattern: track the
  // previous count in state and bump the reset key on the non-empty→empty
  // transition, so the signal is computed synchronously without an effect.
  const checkedRowCount = view.checkedRowCount
  const [selectionResetState, setSelectionResetState] = useState({ resetKey: 0, prevCount: 0 })
  if (selectionResetState.prevCount !== checkedRowCount) {
    setSelectionResetState((current) => ({
      resetKey:
        current.prevCount > 0 && checkedRowCount === 0 ? current.resetKey + 1 : current.resetKey,
      prevCount: checkedRowCount,
    }))
  }
  const resetSelectionKey = selectionResetState.resetKey

  // ---------------------------------------------------------------------------
  // Editor callbacks context — provides real updateCellValue to editors inside
  // BaseGridView (which uses NOOP_EDITOR_CALLBACKS).
  //
  // syncCellValue is intentionally a no-op here: calling the real one during
  // typing would update the backing row array, changing the rows prop, which
  // triggers auto column width recomputation → new editor configuration
  // references → editor unmount/remount → focus loss.
  // ---------------------------------------------------------------------------
  const editorCallbacksContext: EditorCallbacksContextType = useMemo(
    () => ({
      tabId: tabId,
      updateCellValue: storeUpdateCellValue,

      syncCellValue: () => {},
    }),
    [tabId, storeUpdateCellValue]
  )

  const { foreignKeyLookupTarget, openForeignKeyLookup, closeForeignKeyLookup } = useFkLookupFlow()
  const isForeignKeyLookupOpen = foreignKeyLookupTarget !== null
  const ignoreForeignKeyShortcutUntilRef = useRef(0)
  const restoreGridFocusAfterForeignKeyCloseRef = useRef(false)

  const blobViewer = useBlobViewerState({
    tabId: tabId,
    columns: columns,
    primaryKeyColumns: primaryKeyColumns,
  })
  const { openBlobViewer } = blobViewer

  // ---------------------------------------------------------------------------
  // Column descriptors: TableDataColumnMeta[] → GridColumnDescriptor[]
  // ---------------------------------------------------------------------------
  const descriptorColumns = useMemo(
    () =>
      buildColumnDescriptors(columns, isReadOnly, hasPrimaryKey, foreignKeys).map((column) => ({
        ...column,
        width: columnWidths[column.key],
      })),
    [columns, isReadOnly, hasPrimaryKey, foreignKeys, columnWidths]
  )

  // ---------------------------------------------------------------------------
  // Row data: transform array-of-arrays → array-of-objects for BaseGridView.
  // Overlays editState current values, __editingRowKey, and __tempId.
  // ---------------------------------------------------------------------------
  const rowData: TableDataRow[] = useMemo(() => {
    const source = { rows, columns, primaryKeyColumns, editState }
    return rows.map((_, rowIndex) => buildTableDataRow(source, rowIndex))
  }, [rows, columns, primaryKeyColumns, editState])

  // Keep a ref to the latest rowData for post-async lookups
  const rowDataRef = useRef<TableDataRow[]>(rowData)
  useEffect(() => {
    rowDataRef.current = rowData
  }, [rowData])

  useEffect(() => {
    if (!columnJumpRequest) return
    const index = descriptorColumns.findIndex(
      (column) => column.key === columnJumpRequest.columnKey
    )
    if (index < 0) return

    const selectedCell = tabState?.selectedCell
    const jumpRow = selectedRowKey
      ? rowData[findRowIndexByKey(rowData, selectedRowKey, primaryKeyColumns)]
      : undefined
    const movesSelectedCell =
      selectedCell != null &&
      jumpRow !== undefined &&
      selectedCell.columnKey !== columnJumpRequest.columnKey
    if (movesSelectedCell) {
      setSelectedCell(tabId, {
        columnKey: columnJumpRequest.columnKey,
        value: jumpRow[columnJumpRequest.columnKey],
      })
      consumeColumnJump(tabId)
      return
    }
    gridRef.current?.scrollToCell({ idx: index }, 'horizontal')
    consumeColumnJump(tabId)
  }, [
    columnJumpRequest,
    consumeColumnJump,
    descriptorColumns,
    primaryKeyColumns,
    rowData,
    selectedRowKey,
    setSelectedCell,
    tabId,
    tabState?.selectedCell,
  ])

  // ---------------------------------------------------------------------------
  // Row key getter — CRITICAL: complex row identity logic
  // ---------------------------------------------------------------------------
  const rowKeyGetter = useCallback(
    (row: TableDataRow) => {
      if (row.__tempId) return String(row.__tempId)
      if (row.__editingRowKey && typeof row.__editingRowKey === 'object') {
        return JSON.stringify(Object.values(row.__editingRowKey as Record<string, unknown>))
      }
      if (primaryKeyColumns.length > 0) {
        return JSON.stringify(primaryKeyColumns.map((columnName) => row[columnName]))
      }
      return String(row.__rowIndex)
    },
    [primaryKeyColumns]
  )

  const buildCurrentValuesFromRow = useCallback(
    (row: Record<string, unknown>) => {
      const currentValues: Record<string, unknown> = {}
      columns.forEach((column) => {
        currentValues[column.name] = row[column.name]
      })
      return currentValues
    },
    [columns]
  )

  const ensureRowEditingStarted = useCallback(
    (targetRowKey: Record<string, unknown>, row: Record<string, unknown>) => {
      const currentEditRowKey = useTableDataStore.getState().tabs[tabId]?.editState?.rowKey ?? null
      if (!isSameRowKey(targetRowKey, currentEditRowKey)) {
        startEditing(tabId, targetRowKey, buildCurrentValuesFromRow(row))
      }
    },
    [buildCurrentValuesFromRow, startEditing, tabId]
  )

  // ---------------------------------------------------------------------------
  // Row class: editing row, new row styles, selected row highlight
  // Using standardised class names from Phase 1.
  // ---------------------------------------------------------------------------
  const getRowClass = useCallback(
    (row: TableDataRow) => {
      const rowKey = getRowKey(row, primaryKeyColumns)
      const classes = editingRowClasses(editState, rowKey)

      if (selectedRowKey && isSameRowKey(rowKey, selectedRowKey)) {
        classes.push('grid-row-precision-selected')
      }

      return classes.length > 0 ? classes.join(' ') : undefined
    },
    [editState, primaryKeyColumns, selectedRowKey]
  )

  // ---------------------------------------------------------------------------
  // isModifiedCell — reads LATEST editState from store (not from component
  // state) so that it returns correct results even when the wrapper's
  // editState prop is stale due to the ref pattern.
  // ---------------------------------------------------------------------------
  const isModifiedCell = useCallback(
    (rowData: Record<string, unknown>, columnKey: string) => {
      const currentEditState = useTableDataStore.getState().tabs[tabId]?.editState
      if (!currentEditState) return false

      const rowKey = getRowKey(rowData, primaryKeyColumns)
      if (!isSameRowKey(rowKey, currentEditState.rowKey)) return false

      return currentEditState.modifiedColumns.has(columnKey)
    },
    [tabId, primaryKeyColumns]
  )

  // ---------------------------------------------------------------------------
  // Shared edit state for BaseGridView (lighter RowEditState shape)
  // ---------------------------------------------------------------------------
  const sharedEditState: SharedRowEditState | null = useMemo(() => {
    if (!editState) return null
    return {
      rowKey: JSON.stringify(editState.rowKey),
      currentValues: editState.currentValues,
      originalValues: editState.originalValues,
    }
  }, [editState])

  // ---------------------------------------------------------------------------
  // Auto-size configuration
  //
  // Always enabled — the editStateRef pattern already prevents the rowData →
  // rows → autoColumnWidths → column recomputation chain that would
  // destabilise editor references during editing.
  //
  // Precomputed: column lookup map is built once in the surrounding useMemo.
  // computeWidth builds a lightweight single-column proxy array from only the
  // first AUTO_SIZE_SAMPLE_LIMIT rows (the rows getAutoSizedColumnWidth reads),
  // matching ResultGridView and keeping the total work O(100) per col.
  // ---------------------------------------------------------------------------
  const autoSizeConfig: AutoSizeConfig | undefined = useMemo(() => {
    // Precompute: name → column meta lookup
    const columnMetaByName = new Map<string, TableDataColumnMeta>()
    const columnIndexByName = new Map<string, number>()
    for (let columnIndex = 0; columnIndex < columns.length; columnIndex++) {
      columnMetaByName.set(columns[columnIndex].name, columns[columnIndex])
      columnIndexByName.set(columns[columnIndex].name, columnIndex)
    }

    return {
      enabled: true,
      computeWidth: (column: GridColumnDescriptor) => {
        const meta = columnMetaByName.get(column.key)
        const columnIndex = columnIndexByName.get(column.key)
        if (!meta) return DEFAULT_COLUMN_WIDTH_PX
        if (columnIndex == null) return DEFAULT_COLUMN_WIDTH_PX
        // Build a lightweight proxy array that extracts only the target column
        // from the committed table rows, so in-progress edit-state overlays do
        // not cause the visible column to resize under the floating editor.
        // Only the sampled rows are read by getAutoSizedColumnWidth.
        const sampleCount = Math.min(rows.length, AUTO_SIZE_SAMPLE_LIMIT)
        const columnRows: unknown[][] = new Array(sampleCount)
        for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
          columnRows[sampleIndex] = [rows[sampleIndex][columnIndex]]
        }
        // FK icon (Link, 10px) or read-only lock icon (Lock, 10px) + 4px gap.
        // BLOB columns stay editable through the shared viewer, so they show no lock.
        const showLock = !column.editable && column.blobViewerEditable !== true
        const headerIconWidthPx = column.foreignKey || showLock ? HEADER_ICON_WIDTH_PX : 0
        return getAutoSizedColumnWidth(
          meta,
          0, // column is at index 0 in our single-column proxy array
          columnRows,
          column.key,
          headerIconWidthPx
        )
      },
    }
  }, [columns, rows])

  // ---------------------------------------------------------------------------
  // Sort handler — wraps requestNavigationAction + sortByColumn
  // ---------------------------------------------------------------------------
  const handleSortChange = useCallback(
    (column: string | null, direction: 'ASC' | 'DESC' | null) => {
      if (!column || !direction) {
        // Sort was cleared
        if (sort?.column) {
          requestNavigationAction(tabId, () => {
            sortByColumn(tabId, sort.column, null)
          })
        }
        return
      }

      const sortDirection = direction.toLowerCase() as 'asc' | 'desc'
      requestNavigationAction(tabId, () => {
        sortByColumn(tabId, column, sortDirection)
      })
    },
    [sort, tabId, requestNavigationAction, sortByColumn]
  )

  // ---------------------------------------------------------------------------
  // Cell click guard — async edit-guard pattern
  //
  // 1. Capture the target row KEY (not rowIdx which may shift during async)
  // 2. Run async guard (validate temporal, commit editing row, check save errors)
  // 3. If guard passes: find current rowIdx by key, return proceed=true
  //
  // Split into focused helpers for readability; async ordering is preserved.
  // ---------------------------------------------------------------------------

  /** Resolve the target column descriptor and its index in descriptorColumns. */
  const resolveTargetColumn = useCallback(
    (columnKey: string) => {
      const targetColumnIndex = descriptorColumns.findIndex((column) => column.key === columnKey)
      if (targetColumnIndex < 0) return null
      const descriptor = descriptorColumns[targetColumnIndex]
      const editable = descriptor.editable === true
      return { editable: editable, targetColIdx: targetColumnIndex }
    },
    [descriptorColumns]
  )

  /**
   * Validate temporal columns on the current edit state and commit the editing
   * row if switching rows. Returns `true` if the guard passed (or no commit
   * was needed), `false` if it failed (validation error or save error).
   */
  const commitEditingRowBeforeSwitch = useCallback(
    async (currentEditState: NonNullable<TableEditState>, targetRowKey: RowKey) => {
      if (reportInvalidTemporalValue(currentEditState, columns)) {
        setSelectedRow(tabId, currentEditState.rowKey)
        return false
      }
      const hadPendingChanges = currentEditState.modifiedColumns.size > 0
      await commitEditingRowIfNeeded(tabId, targetRowKey)
      const updatedState = useTableDataStore.getState().tabs[tabId]
      if (updatedState?.saveError) {
        showError('Save failed', updatedState.saveError)
        if (updatedState.editState) {
          setSelectedRow(tabId, updatedState.editState.rowKey)
        }
        return false
      }
      if (hadPendingChanges) {
        showSuccess('Row saved', 'Changes saved successfully.')
      }
      return true
    },
    [tabId, columns, commitEditingRowIfNeeded, setSelectedRow, showError, showSuccess]
  )

  const validateAndCommitCurrentEdit = useCallback(
    async (
      targetRowKey: Record<string, unknown>,
      fallbackRowIndex: number,
      targetColumnIndex: number,
      options: { enableEditorOnRestore: boolean }
    ): Promise<{ passed: boolean; result?: CellClickGuardResult }> => {
      const currentState = useTableDataStore.getState().tabs[tabId]
      const currentEditState = currentState?.editState ?? null
      const isSwitchingRows =
        currentEditState !== null && !isSameRowKey(targetRowKey, currentEditState.rowKey)
      if (!isSwitchingRows) return { passed: true }

      const restoreFocusResult: CellClickGuardResult = {
        proceed: false,
        targetRowIdx: resolveRestoreRowIndex(currentState, fallbackRowIndex),
        targetColIdx: targetColumnIndex,
        enableEditor: options.enableEditorOnRestore,
        restoreFocus: true,
      }
      const committed = await commitEditingRowBeforeSwitch(currentEditState, targetRowKey)
      if (!committed) return { passed: false, result: restoreFocusResult }
      return { passed: true }
    },
    [tabId, commitEditingRowBeforeSwitch]
  )

  /** Find the current row index for a given row key in the latest rowData snapshot. */
  const findCurrentRowIndex = useCallback(
    (targetRowKey: Record<string, unknown>): number => {
      return findRowIndexByKey(rowDataRef.current, targetRowKey, primaryKeyColumns)
    },
    [primaryKeyColumns]
  )

  const handleCellClickGuard = useCallback(
    async (args: CellClickGuardArgs): Promise<CellClickGuardResult> => {
      if (isPointerOrUnknownSource(args.source)) {
        clearColumnHighlight(tabId)
      }
      const row = args.rowData
      const targetRowKey = getRowKey(row, primaryKeyColumns)
      const isKeyboardNavigation = args.source === 'keyboard'
      const isKeyboardTyping = args.source === 'keyboard-typing'

      // Resolve target column descriptor
      const target = resolveTargetColumn(args.columnKey)
      if (!target) {
        return {
          proceed: false,
          targetRowIdx: args.rowIdx,
          targetColIdx: 0,
          enableEditor: false,
        }
      }
      const { editable, targetColIdx: targetColumnIndex } = target

      // Validate and commit current edit if switching rows (async guard)
      const guardResult = await validateAndCommitCurrentEdit(
        targetRowKey,
        args.rowIdx,
        targetColumnIndex,
        { enableEditorOnRestore: !isKeyboardNavigation }
      )
      if (!guardResult.passed) {
        return guardResult.result!
      }

      // Guard passed — NOW update selectedRowKey and selectedCell
      setSelectedRow(tabId, targetRowKey)
      setSelectedCell(tabId, { columnKey: args.columnKey, value: args.rowData[args.columnKey] })

      if (!editable) {
        const rowIndex = findCurrentRowIndex(targetRowKey)
        return {
          proceed: true,
          targetRowIdx: rowIndex >= 0 ? rowIndex : args.rowIdx,
          targetColIdx: targetColumnIndex,
          enableEditor: false,
        }
      }

      // Start tracking the new row for editable cells, including keyboard typing activation.
      ensureRowEditingStarted(targetRowKey, row)

      // Find current rowIdx for captured row key and keep pointer single-click selection-only.
      const finalRowIndex = findCurrentRowIndex(targetRowKey)

      if (finalRowIndex >= 0) {
        return {
          proceed: true,
          targetRowIdx: finalRowIndex,
          targetColIdx: targetColumnIndex,
          enableEditor: isKeyboardTyping,
        }
      }

      return {
        proceed: false,
        targetRowIdx: args.rowIdx,
        targetColIdx: targetColumnIndex,
        enableEditor: false,
      }
    },
    [
      primaryKeyColumns,
      tabId,
      resolveTargetColumn,
      validateAndCommitCurrentEdit,
      findCurrentRowIndex,
      ensureRowEditingStarted,
      setSelectedRow,
      setSelectedCell,
      clearColumnHighlight,
    ]
  )

  // ---------------------------------------------------------------------------
  // onRowsChange: called when an editor commits — used to clear no-op edits
  // ---------------------------------------------------------------------------
  const syncCommittedEditorValue = useCallback(
    (row: TableDataRow, changedColumnKey: string) => {
      const currentEditState = useTableDataStore.getState().tabs[tabId]?.editState
      if (!currentEditState) return
      const rowKey =
        (row.__editingRowKey as RowKey | undefined) ?? getRowKey(row, primaryKeyColumns)
      if (!isSameRowKey(rowKey, currentEditState.rowKey)) return
      useTableDataStore
        .getState()
        .syncCellValue(
          tabId,
          { ...row, __editingRowKey: rowKey },
          changedColumnKey,
          row[changedColumnKey],
          rowKey
        )
    },
    [primaryKeyColumns, tabId]
  )

  const handleRowsChange = useCallback(
    (newRows: TableDataRow[], data: { indexes: number[]; column?: { key: string } }) => {
      const changedColumnKey = data.column?.key
      const changedRows = data.indexes.map((index) => newRows[index]).filter(Boolean)
      if (changedColumnKey) {
        changedRows.forEach((row) => syncCommittedEditorValue(row, changedColumnKey))
      }
      changedRows.forEach((row) =>
        clearEditStateIfUnmodified(tabId, getRowKey(row, primaryKeyColumns))
      )
    },
    [primaryKeyColumns, tabId, clearEditStateIfUnmodified, syncCommittedEditorValue]
  )

  const handleCellClipboardEdit = useCallback(
    async (args: CellClipboardEditArgs): Promise<boolean> => {
      const target = resolveTargetColumn(args.columnKey)
      if (!target?.editable) return false

      const targetRowKey = getRowKey(args.rowData, primaryKeyColumns)

      const guardResult = await validateAndCommitCurrentEdit(
        targetRowKey,
        args.rowIdx,
        target.targetColIdx,
        { enableEditorOnRestore: true }
      )
      if (!guardResult.passed) return false

      setSelectedRow(tabId, targetRowKey)

      ensureRowEditingStarted(targetRowKey, args.rowData)

      const nextValue = args.action === 'cut' ? null : (args.text ?? null)
      storeUpdateCellValue(tabId, args.columnKey, nextValue)
      useTableDataStore
        .getState()
        .syncCellValue(tabId, args.rowData, args.columnKey, nextValue, targetRowKey)
      return true
    },
    [
      resolveTargetColumn,
      primaryKeyColumns,
      validateAndCommitCurrentEdit,
      setSelectedRow,
      tabId,
      ensureRowEditingStarted,
      storeUpdateCellValue,
    ]
  )

  const handleCellValueChange = useCallback(
    (rowIndex: number, columnKey: string, nextValue: unknown) => {
      const row = rowDataRef.current[rowIndex]
      if (!row) return
      storeUpdateCellValue(tabId, columnKey, nextValue)
    },
    [storeUpdateCellValue, tabId]
  )

  // ---------------------------------------------------------------------------
  // FK Lookup callback — runs the unsaved-edit guard, then stores the lookup
  // request in local state. Phase 6B renders FkLookupDialog with this context.
  // ---------------------------------------------------------------------------
  const handleForeignKeyLookup = useCallback(
    async (args: FkLookupArgs) => {
      if (args.source === 'grid-pointer' && Date.now() < ignoreForeignKeyShortcutUntilRef.current) {
        return
      }

      const targetRowKey = getRowKey(args.rowData, primaryKeyColumns)

      // Find the row index in the latest rowData snapshot
      const fallbackRowIndex = findRowIndexByKey(
        rowDataRef.current,
        targetRowKey,
        primaryKeyColumns
      )

      // Find the column index in descriptorColumns
      const targetColumnIndex = descriptorColumns.findIndex(
        (column) => column.key === args.columnKey
      )

      // Run the unsaved-edit guard (same pattern as cell click guard)
      const guardResult = await validateAndCommitCurrentEdit(
        targetRowKey,
        fallbackRowIndex >= 0 ? fallbackRowIndex : 0,
        targetColumnIndex >= 0 ? targetColumnIndex : 0,
        { enableEditorOnRestore: args.source !== 'keyboard' }
      )

      if (guardResult.passed) {
        setSelectedRow(tabId, targetRowKey)
        openForeignKeyLookup(args)
      }
    },
    [
      primaryKeyColumns,
      descriptorColumns,
      validateAndCommitCurrentEdit,
      setSelectedRow,
      tabId,
      openForeignKeyLookup,
    ]
  )

  const handleForeignKeyCellAction = useCallback(
    async (args: CellClickGuardArgs) => {
      const foreignKey = descriptorColumns.find(
        (column) => column.key === args.columnKey
      )?.foreignKey
      if (!foreignKey) return
      await handleForeignKeyLookup({
        columnKey: args.columnKey,
        currentValue: args.rowData[args.columnKey],
        foreignKey: foreignKey,
        rowData: args.rowData,
        source: args.source === 'keyboard' ? 'keyboard' : 'grid-pointer',
      })
    },
    [descriptorColumns, handleForeignKeyLookup]
  )

  // ---------------------------------------------------------------------------
  // BLOB cell double-click — open the viewer only when a PK is resolvable so the
  // dialog can lazily fetch the real bytes. When no PK is resolvable (read-only
  // connection or PK-less table), the grid only holds the placeholder, so the
  // affordance is disabled rather than showing a misleading view-only dialog.
  // ---------------------------------------------------------------------------
  const handleCellDoubleClick = useCallback(
    (row: Record<string, unknown>, columnKey: string) => {
      const descriptor = descriptorColumns.find((column) => column.key === columnKey)
      if (!descriptor?.blobViewer) return

      // Resolve PK column→value pairs for the lazy fetch + edit gating.
      const canEdit = !isReadOnly && hasPrimaryKey && primaryKeyColumns.length > 0
      if (!canEdit) return
      openBlobViewer(columnKey, row)
    },
    [descriptorColumns, isReadOnly, hasPrimaryKey, primaryKeyColumns, openBlobViewer]
  )

  const editableColumnKeys = useMemo(() => {
    return new Set(
      descriptorColumns.filter((column) => column.editable).map((column) => column.key)
    )
  }, [descriptorColumns])

  const selectedCellPosition = useMemo(() => {
    const selected = tabState?.selectedCell
    if (!selected) return null
    const rowIndex = selectedRowKey
      ? findRowIndexByKey(rowData, selectedRowKey, primaryKeyColumns)
      : -1
    const index = descriptorColumns.findIndex((column) => column.key === selected.columnKey)
    return rowIndex >= 0 && index >= 0 ? { rowIdx: rowIndex, idx: index } : null
  }, [descriptorColumns, primaryKeyColumns, rowData, selectedRowKey, tabState?.selectedCell])

  useLayoutEffect(() => {
    if (
      isForeignKeyLookupOpen ||
      !restoreGridFocusAfterForeignKeyCloseRef.current ||
      !selectedCellPosition
    ) {
      return
    }

    restoreGridFocusAfterForeignKeyCloseRef.current = false
    gridRef.current?.selectCell(selectedCellPosition, {
      shouldFocusCell: true,
      enableEditor: false,
    })
  }, [isForeignKeyLookupOpen, selectedCellPosition])

  const handleForeignKeyLookupClose = () => {
    ignoreForeignKeyShortcutUntilRef.current = Date.now() + FOREIGN_KEY_SHORTCUT_COOLDOWN_MS
    restoreGridFocusAfterForeignKeyCloseRef.current = true
    closeForeignKeyLookup()
  }

  // ---------------------------------------------------------------------------
  // FK Apply callback — applies the selected FK value to the editing cell.
  // ---------------------------------------------------------------------------
  const handleForeignKeyApply = useCallback(
    (selectedValue: unknown) => {
      if (!foreignKeyLookupTarget) return
      const { columnKey, rowData: foreignKeyRowData } = foreignKeyLookupTarget

      // Extract row key using the existing getRowKey helper + pkColumns
      const rowKey = getRowKey(foreignKeyRowData, primaryKeyColumns)

      // If the selected value is the same as the current cell value AND
      // there's no existing edit with modifications on this row, skip editing
      const currentCellValue = foreignKeyLookupTarget.currentValue
      const currentEditState = useTableDataStore.getState().tabs[tabId]?.editState
      const isAlreadyEditing = currentEditState && isSameRowKey(currentEditState.rowKey, rowKey)

      if (
        selectedValue === currentCellValue &&
        (!isAlreadyEditing || currentEditState.modifiedColumns.size === 0)
      ) {
        setSelectedRow(tabId, rowKey)
        closeForeignKeyLookup()
        return
      }

      // Check if this row is already being edited; if not, start editing
      if (!currentEditState || !isSameRowKey(currentEditState.rowKey, rowKey)) {
        ensureRowEditingStarted(rowKey, foreignKeyRowData)
      }

      // Update the FK cell with the selected value
      storeUpdateCellValue(tabId, columnKey, selectedValue)
      useTableDataStore
        .getState()
        .syncCellValue(tabId, foreignKeyRowData, columnKey, selectedValue, rowKey)

      // Select the edited row so toolbar actions target it correctly
      setSelectedRow(tabId, rowKey)

      // Close the dialog
      closeForeignKeyLookup()
    },
    [
      foreignKeyLookupTarget,
      tabId,
      primaryKeyColumns,
      ensureRowEditingStarted,
      storeUpdateCellValue,
      setSelectedRow,
      closeForeignKeyLookup,
    ]
  )

  // ---------------------------------------------------------------------------
  // Render: wrap BaseGridView with EditorCallbacksContext and FkLookupProvider
  // ---------------------------------------------------------------------------
  return (
    <EditorCallbacksContext.Provider value={editorCallbacksContext}>
      <FkLookupProvider onFkLookup={handleForeignKeyLookup}>
        <CanvasBaseGridView
          ref={gridRef}
          rows={rowData}
          columns={descriptorColumns}
          editState={sharedEditState}
          {...gridSortProps(sort)}
          onSortChange={handleSortChange}
          onCellClickGuard={handleCellClickGuard}
          onCellClipboardEdit={handleCellClipboardEdit}
          onRowsChange={handleRowsChange}
          onCellValueChange={handleCellValueChange}
          rowKeyGetter={rowKeyGetter}
          getRowClass={getRowClass}
          isModifiedCell={isModifiedCell}
          autoSizeConfig={autoSizeConfig}
          isEditMode={canEditRows}
          editableColumnKeys={editableColumnKeys}
          runCellClickGuardOnKeyboardSelection={canEditRows}
          selectedCellPosition={selectedCellPosition}
          highlightColumnKey={highlightedColumnKey}
          onCellSelectionChange={(args) => {
            if (isPointerOrUnknownSource(args.source)) {
              clearColumnHighlight(tabId)
            }
          }}
          onSelectedCellChange={(position) => {
            const column = descriptorColumns[position.idx]
            const row = rowData[position.rowIdx]
            if (column && row) {
              setSelectedRow(tabId, getRowKey(row, primaryKeyColumns))
              setSelectedCell(tabId, { columnKey: column.key, value: row[column.key] })
            }
          }}
          onColumnResize={handleColumnResize}
          onScrollCellChange={handleScrollCellChange}
          initialScrollCell={{ scrollRow: view.scrollRow, scrollCol: view.scrollCol }}
          scrollToRowIndex={draftScrollRowIndex(editState, rows.length)}
          onFkCellAction={handleForeignKeyCellAction}
          onCellDoubleClick={handleCellDoubleClick}
          rowMarkers="checkbox"
          onRowMarkersChange={handleRowMarkersChange}
          resetSelectionKey={resetSelectionKey}
          testId="table-data-grid"
          isActive={isActive}
        />
        {foreignKeyLookupTarget && (
          <ForeignKeyLookupTargetDialog
            target={foreignKeyLookupTarget}
            tableLocation={tabState}
            isReadOnly={!canEditRows}
            onClose={handleForeignKeyLookupClose}
            onApply={handleForeignKeyApply}
          />
        )}
        <BlobViewerTargetDialog viewer={blobViewer} />
      </FkLookupProvider>
    </EditorCallbacksContext.Provider>
  )
}
