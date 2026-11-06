/**
 * ResultGridView — thin wrapper around the shared BaseGridView for query results.
 *
 * Rows are **windowed**: the Rust result cache owns them and the grid reads a
 * windowed row source backed by the non-reactive page cache
 * (`result-window-cache`). Unloaded rows render as skeleton cells, the visible
 * range drives page loads, and Copy/Cut/Clear/Paste fetch unloaded rows first.
 *
 * Responsibilities:
 * - Serves page-cache rows as keyed `{ __rowIdx, __baseIdx, col_N }` objects
 *   (`__rowIdx` = view position, `__baseIdx` = stable base index)
 * - Builds GridColumnDescriptor[] from ColumnMeta[] + editableColumnMap
 * - Translates col_N ↔ real column names in sort, cell click guard, and onRowsChange
 * - Adapts the rich RowEditState (schema.ts) to the simple RowEditState (shared-data-view.ts)
 * - Provides isModifiedCell and getRowClass callbacks
 *
 * The external props interface remains unchanged — ResultPanel.tsx does not need modification.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CanvasBaseGridView } from '../shared/glide/CanvasBaseGridView'
import { BlobViewerDialog } from '../dialogs/BlobViewerDialog'
import { isBinaryDataType } from '../../lib/blob-utils'
import type { BlobEnvelope } from '../../types/schema'
import {
  EditorCallbacksContext,
  type EditorCallbacksContextType,
} from '../shared/editor-callbacks-context'
import { colKey, colIndexFromKey } from '../../lib/col-key-utils'
import { AUTO_SIZE_SAMPLE_LIMIT, getAutoSizedColumnWidth } from '../../lib/grid-column-style'
import { isJsonSqlType } from '../../lib/grid-column-style'
import { resolveQueryResultColumns } from '../../lib/query-result-column-utils'
import {
  createWindowRowMaterializer,
  materializeRow,
  toCachedRow,
  type ResultRow,
} from '../../lib/result-row-materializer'
import {
  getLoadedRow,
  readViewRange,
  requestVisibleRange,
  subscribeToResultWindow,
  type CachedRow,
} from '../../lib/result-window-cache'
import type { ColumnMeta, TableDataColumnMeta, RowEditState } from '../../types/schema'
import { countRanges, useQueryStore } from '../../stores/query-store'
import type { GridRowSource, RowRange } from '../shared/glide/grid-row-source'
import type { GridRowActions } from '../shared/glide/CanvasBaseGridView'
import type {
  GridColumnDescriptor,
  RowEditState as SharedRowEditState,
  CellClickGuardArgs,
  CellClickGuardResult,
  CellClipboardEditArgs,
  AutoSizeConfig,
} from '../../types/shared-data-view'
import type { GridCellPosition } from '../shared/glide/glide-grid-types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ResultGridView
// ---------------------------------------------------------------------------

interface ResultGridViewProps {
  columns: ColumnMeta[]
  /** Result index within the tab (page-cache surface). */
  resultIndex: number
  /** Query id of the cached result (changes on every re-run). */
  queryId: string | null
  /** Rows in the current view. */
  viewRowCount: number
  /** View version of the current view (changes on sort, filter and deletes). */
  viewVersion: number
  /** Clone draft row shown as a virtual row after the last view row, or null. */
  draftRow: unknown[] | null
  sortColumn: string | null
  sortDirection: 'asc' | 'desc' | null
  onSortChanged: (column: string, direction: 'asc' | 'desc' | null) => void
  onRowSelected: (rowIndex: number) => void
  selectedRowIndex: number | null
  /** Tab identifier — passed through to cell editor context for store syncing. */
  tabId: string
  /** Active edit table name, or null for read-only mode. */
  editMode: string | null
  /** Column index → editable boolean for the selected edit table. */
  editableColumnMap: Map<number, boolean>
  /** Current row edit state. */
  editState: RowEditState | null
  /** View position of the editing row. */
  editingRowIndex: number | null
  /** Base index of the editing row (null for the clone draft). */
  editingBaseIndex: number | null
  /** Column metadata from the edit table (for cell editor selection). */
  editTableColumns: TableDataColumnMeta[]
  /** FK metadata from the edit table (single-column constraints only). */
  editForeignKeys?: import('../../types/schema').ForeignKeyColumnInfo[]
  /** Result column index → bound source-table column name. */
  editColumnBindings: Map<number, string>
  /** Start editing a row by its view position (`row` when it isn't in the page cache). */
  onStartEditing: (rowIndex: number, row?: CachedRow) => void
  /** Update a cell value in the edit state (result column index). */
  onUpdateCellValue: (columnIndex: number, value: unknown) => void
  /** Sync a cell value to both edit state and local rows. */
  onSyncCellValue: (columnIndex: number, value: unknown) => void
  /** Auto-save the current editing row (called on row transition). */
  onAutoSave: () => Promise<boolean>
  /** Progress and expiry hooks for grid actions that fetch unloaded rows first. */
  rowActions?: GridRowActions
  isActive?: boolean
}

const EMPTY_EDITABLE_MAP = new Map<number, boolean>()
const EMPTY_TABLE_COLUMNS: TableDataColumnMeta[] = []
const EMPTY_FOREIGN_KEYS: import('../../types/schema').ForeignKeyColumnInfo[] = []
const EMPTY_BINDINGS = new Map<number, string>()
const EMPTY_ROWS: ResultRow[] = []

/** True when `row` is the editing row: by base index, or by position for the clone draft. */
function isEditingRowData(
  row: Record<string, unknown>,
  editingRowIndex: number | null,
  editingBaseIndex: number | null
): boolean {
  if (editingRowIndex === null) return false
  const baseIndex = typeof row.__baseIdx === 'number' ? row.__baseIdx : -1
  if (baseIndex >= 0) return editingBaseIndex !== null && baseIndex === editingBaseIndex
  return row.__rowIdx === editingRowIndex
}
const READ_ONLY_SELECTION_SYNC_DELAY_MS = 75

export function ResultGridView({
  columns,
  resultIndex,
  queryId,
  viewRowCount,
  viewVersion,
  draftRow,
  sortColumn,
  sortDirection,
  onSortChanged,
  onRowSelected,
  selectedRowIndex,
  tabId,
  editMode = null,
  editableColumnMap = EMPTY_EDITABLE_MAP,
  editState = null,
  editingRowIndex = null,
  editingBaseIndex = null,
  editTableColumns = EMPTY_TABLE_COLUMNS,
  editForeignKeys = EMPTY_FOREIGN_KEYS,
  editColumnBindings = EMPTY_BINDINGS,
  onStartEditing,
  onUpdateCellValue,
  onSyncCellValue,
  onAutoSave,
  rowActions,
  isActive = true,
}: ResultGridViewProps) {
  const storeSetSelectedCell = useQueryStore((state) => state.setSelectedCell)
  const storeSetResultScrollCell = useQueryStore((state) => state.setResultScrollCell)
  const storeSetCheckedRanges = useQueryStore((state) => state.setCheckedRanges)
  const selectedCell = useQueryStore((state) => {
    const tab = state.tabs[tabId]
    const activeResultIndex = tab?.activeResultIndex ?? 0
    return tab?.results[activeResultIndex]?.selectedCell ?? null
  })
  const checkedRowCount = useQueryStore((state) => {
    const tab = state.tabs[tabId]
    const activeResultIndex = tab?.activeResultIndex ?? 0
    return countRanges(tab?.results[activeResultIndex]?.checkedRanges ?? [])
  })
  const storeScrollRow = useQueryStore((state) => {
    const tab = state.tabs[tabId]
    const activeResultIndex = tab?.activeResultIndex ?? 0
    return tab?.results[activeResultIndex]?.scrollRow ?? 0
  })
  const storeScrollCol = useQueryStore((state) => {
    const tab = state.tabs[tabId]
    const activeResultIndex = tab?.activeResultIndex ?? 0
    return tab?.results[activeResultIndex]?.scrollCol ?? 0
  })
  const initialScrollCell = useMemo(
    () => ({ scrollRow: storeScrollRow, scrollCol: storeScrollCol }),
    [storeScrollRow, storeScrollCol]
  )

  const handleScrollCellChange = useCallback(
    (scrollRow: number, scrollCol: number) => {
      storeSetResultScrollCell(tabId, scrollRow, scrollCol)
    },
    [storeSetResultScrollCell, tabId]
  )

  // Multi-select checkbox column — checked rows are view-position ranges tagged
  // with the view version (D17); header select-all never loads every row.
  const handleRowMarkerRangesChange = useCallback(
    (ranges: RowRange[]) => {
      // The virtual clone-draft row can't be checked.
      const clamped = ranges
        .map(([start, end]) => [start, Math.min(end, viewRowCount)] as const)
        .filter(([start, end]) => end > start)
      storeSetCheckedRanges(tabId, clamped)
    },
    [storeSetCheckedRanges, tabId, viewRowCount]
  )

  // The grid always mounts with no checked rows (e.g. after switching result
  // sub-tabs or view modes), so drop any stale checked ranges from the store
  // to keep the toolbar's copy/delete state in sync with what's visible.
  useEffect(() => {
    storeSetCheckedRanges(tabId, [])
  }, [storeSetCheckedRanges, tabId])

  // When the store's checked set transitions from non-empty to empty (e.g. the
  // toolbar cleared it after a bulk delete), push a reset signal down to the
  // grid so its internal CompactSelection.rows checkmarks are cleared too.
  // Uses the documented "adjust state during render" pattern: track the
  // previous count in state and bump the reset key on the non-empty→empty
  // transition, so the signal is computed synchronously without an effect.
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
  // BLOB viewer (view-only) — query results inline the blob bytes as base64, so
  // double-clicking a binary cell opens the shared dialog seeded with those
  // bytes. No PK exists for query results, so no staging or lazy fetch happens.
  // ---------------------------------------------------------------------------
  const [blobDialogOpen, setBlobDialogOpen] = useState(false)
  const [blobContext, setBlobContext] = useState<{
    rowIndex: number
    row: CachedRow
    columnIndex: number
    columnLabel: string
    base64: string | null
    editable: boolean
  } | null>(null)

  const closeBlobDialog = useCallback(() => {
    setBlobDialogOpen(false)
    setBlobContext(null)
  }, [])

  // Refs for stable access in callbacks without re-creating them
  const editStateRef = useRef(editState)
  const editingRowIndexRef = useRef(editingRowIndex)
  const columnsRef = useRef(columns)
  const onSyncCellValueRef = useRef(onSyncCellValue)
  const onRowSelectedRef = useRef(onRowSelected)
  const storeSetSelectedCellRef = useRef(storeSetSelectedCell)
  const pendingReadOnlySelectionRef = useRef<{
    rowIdx: number
    columnKey: string
    value: unknown
  } | null>(null)
  const readOnlySelectionSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSyncedSelectionRef = useRef<{
    rowIdx: number
    columnKey: string
    value: unknown
  } | null>(null)

  useEffect(() => {
    editStateRef.current = editState
  }, [editState])

  useEffect(() => {
    editingRowIndexRef.current = editingRowIndex
  }, [editingRowIndex])

  const editingBaseIndexRef = useRef(editingBaseIndex)
  useEffect(() => {
    editingBaseIndexRef.current = editingBaseIndex
  }, [editingBaseIndex])

  useEffect(() => {
    columnsRef.current = columns
  }, [columns])

  useEffect(() => {
    onSyncCellValueRef.current = onSyncCellValue
  }, [onSyncCellValue])

  useEffect(() => {
    onRowSelectedRef.current = onRowSelected
  }, [onRowSelected])

  useEffect(() => {
    storeSetSelectedCellRef.current = storeSetSelectedCell
  }, [storeSetSelectedCell])

  useEffect(() => {
    lastSyncedSelectionRef.current = null
    pendingReadOnlySelectionRef.current = null
    if (readOnlySelectionSyncTimerRef.current) {
      clearTimeout(readOnlySelectionSyncTimerRef.current)
      readOnlySelectionSyncTimerRef.current = null
    }
  }, [queryId, viewVersion, columns, tabId])

  useEffect(() => {
    return () => {
      if (readOnlySelectionSyncTimerRef.current) {
        clearTimeout(readOnlySelectionSyncTimerRef.current)
      }
    }
  }, [])

  const flushPendingReadOnlySelection = useCallback(() => {
    readOnlySelectionSyncTimerRef.current = null
    const pendingSelection = pendingReadOnlySelectionRef.current
    if (!pendingSelection) return

    pendingReadOnlySelectionRef.current = null
    const columnIndex = colIndexFromKey(pendingSelection.columnKey)
    const column = columnsRef.current[columnIndex]

    onRowSelectedRef.current(pendingSelection.rowIdx)
    if (!column) return

    storeSetSelectedCellRef.current(tabId, {
      columnKey: column.name,
      value: pendingSelection.value,
    })
  }, [tabId])

  const scheduleReadOnlySelectionSync = useCallback(
    (rowIdx: number, columnKey: string, selectedRow: Record<string, unknown>) => {
      pendingReadOnlySelectionRef.current = {
        rowIdx,
        columnKey,
        value: selectedRow[columnKey],
      }

      if (readOnlySelectionSyncTimerRef.current) {
        clearTimeout(readOnlySelectionSyncTimerRef.current)
      }

      readOnlySelectionSyncTimerRef.current = setTimeout(
        flushPendingReadOnlySelection,
        READ_ONLY_SELECTION_SYNC_DELAY_MS
      )
    },
    [flushPendingReadOnlySelection]
  )

  const syncSelection = useCallback(
    (rowIdx: number, columnKey: string, selectedRow: Record<string, unknown>) => {
      const nextValue = selectedRow[columnKey]
      const lastSelection = lastSyncedSelectionRef.current
      if (
        lastSelection?.rowIdx === rowIdx &&
        lastSelection.columnKey === columnKey &&
        Object.is(lastSelection.value, nextValue)
      ) {
        return
      }
      lastSyncedSelectionRef.current = { rowIdx, columnKey, value: nextValue }
      onRowSelected(rowIdx)

      const columnIndex = colIndexFromKey(columnKey)
      const column = columns[columnIndex]
      if (!column) return

      storeSetSelectedCell(tabId, {
        columnKey: column.name,
        value: nextValue,
      })
    },
    [columns, onRowSelected, storeSetSelectedCell, tabId]
  )

  const handleCellSelectionChange = useCallback(
    (args: CellClickGuardArgs) => {
      scheduleReadOnlySelectionSync(args.rowIdx, args.columnKey, args.rowData)
    },
    [scheduleReadOnlySelectionSync]
  )

  const editorCallbacksCtx: EditorCallbacksContextType = useMemo(
    () => ({
      tabId,
      updateCellValue: (_tabId, columnKey, value) => {
        const colIndex = colIndexFromKey(columnKey)
        if (colIndex >= 0) {
          onUpdateCellValue(colIndex, value)
        }
      },
      syncCellValue: () => {},
    }),
    [onUpdateCellValue, tabId]
  )

  // ---------------------------------------------------------------------------
  // Table column lookup map — case-insensitive name → TableDataColumnMeta.
  // Used by column descriptors and shared with the form view pattern.
  // ---------------------------------------------------------------------------
  const boundColumnIndexLookup = useMemo(() => {
    const lookup = new Map<string, number>()
    for (const [index, columnName] of editColumnBindings) {
      lookup.set(columnName, index)
    }
    return lookup
  }, [editColumnBindings])

  // ---------------------------------------------------------------------------
  // Windowed row source: page-cache rows materialized on demand (objects reused
  // by base index). The editing row overlays editState values, and the clone
  // draft is a virtual row right after the last view row.
  // ---------------------------------------------------------------------------
  const columnCount = columns.length
  const [materializer] = useState(() => createWindowRowMaterializer(columnCount))
  const materializerKey = `${queryId ?? ''}:${viewVersion}:${columnCount}`
  const [lastMaterializerKey, setLastMaterializerKey] = useState(materializerKey)
  if (lastMaterializerKey !== materializerKey) {
    setLastMaterializerKey(materializerKey)
    materializer.reset(columnCount)
  }

  const rowSource = useMemo<GridRowSource<ResultRow>>(() => {
    void materializerKey
    const isEditingRow = (position: number, baseIndex: number): boolean =>
      editState !== null &&
      (baseIndex >= 0 ? baseIndex === editingBaseIndex : position === editingRowIndex)
    const overlay = (row: ResultRow): ResultRow => {
      if (!editState) return row
      const overlaid: ResultRow = { ...row }
      for (const [colName, value] of Object.entries(editState.currentValues)) {
        const colIdx = boundColumnIndexLookup.get(colName) ?? -1
        if (colIdx !== -1) overlaid[colKey(colIdx)] = value
      }
      return overlaid
    }
    const getRow = (position: number): ResultRow | undefined => {
      if (draftRow && position === viewRowCount) {
        const draft = materializeRow(position, -1, draftRow, columnCount)
        return isEditingRow(position, -1) ? overlay(draft) : draft
      }
      const cached = getLoadedRow(tabId, resultIndex, position)
      if (!cached) return undefined
      const row = materializer.get(position, cached.baseIndex, cached.row)
      return isEditingRow(position, cached.baseIndex) ? overlay(row) : row
    }
    return {
      kind: 'windowed',
      rowCount: viewRowCount + (draftRow ? 1 : 0),
      getRow,
      isLoaded: (position) => getRow(position) !== undefined,
      onVisibleRangeChange: (range) => requestVisibleRange(tabId, resultIndex, range),
      subscribe: (listener) => subscribeToResultWindow(tabId, resultIndex, listener),
      readRange: async ([start, end], options) => {
        const viewEnd = Math.min(end, viewRowCount)
        const fetched =
          viewEnd > start ? await readViewRange(tabId, resultIndex, [start, viewEnd], options) : []
        const rows = fetched.map((cached, offset) => {
          const position = start + offset
          const row = materializeRow(position, cached.baseIndex, cached.row, columnCount)
          return isEditingRow(position, cached.baseIndex) ? overlay(row) : row
        })
        if (draftRow && end > viewRowCount) {
          const draft = getRow(viewRowCount)
          if (draft) rows.push(draft)
        }
        return rows
      },
    }
  }, [
    boundColumnIndexLookup,
    columnCount,
    draftRow,
    editState,
    editingBaseIndex,
    editingRowIndex,
    materializer,
    materializerKey,
    resultIndex,
    tabId,
    viewRowCount,
  ])
  const rowSourceRef = useRef(rowSource)
  useEffect(() => {
    rowSourceRef.current = rowSource
  }, [rowSource])

  const resolvedColumnsBuild = useMemo(() => {
    const resolved = resolveQueryResultColumns({
      resultColumns: columns,
      editMode,
      editableColumnMap,
      editTableColumns,
      editForeignKeys,
      editColumnBindings,
    })
    return {
      columns: resolved,
    }
  }, [columns, editMode, editableColumnMap, editTableColumns, editForeignKeys, editColumnBindings])
  const resolvedColumns = resolvedColumnsBuild.columns

  // ---------------------------------------------------------------------------
  // Column descriptors: build GridColumnDescriptor[] from ColumnMeta[].
  // ---------------------------------------------------------------------------
  const gridColumns: GridColumnDescriptor[] = useMemo(() => {
    return resolvedColumns.map((column, columnIndex) => ({
      key: column.key,
      displayName: column.displayName,
      dataType: column.dataType,
      editable: column.editable,
      isBinary: isBinaryDataType(column.dataType),
      blobViewer: column.effectiveTableMeta.isBinary,
      blobViewerEditable:
        column.effectiveTableMeta.isBinary &&
        editMode !== null &&
        editColumnBindings.has(columnIndex),
      isNullable: column.tableColumnMeta?.isNullable ?? true,
      isPrimaryKey: column.tableColumnMeta?.isPrimaryKey ?? false,
      isUniqueKey: column.tableColumnMeta?.isUniqueKey ?? false,
      enumValues: column.tableColumnMeta?.enumValues,
      setValues: column.tableColumnMeta?.setValues,
      tableColumnMeta: column.editable ? column.tableColumnMeta : undefined,
      foreignKey: column.foreignKey,
      editorType: column.tableColumnMeta?.enumValues?.length
        ? 'enum'
        : column.tableColumnMeta && isJsonSqlType(column.tableColumnMeta.dataType)
          ? 'json'
          : column.tableColumnMeta?.setValues?.length
            ? 'set'
            : column.tableColumnMeta
              ? 'text'
              : 'none',
    }))
  }, [editColumnBindings, editMode, resolvedColumns])

  const handleCellDoubleClick = useCallback(
    (row: Record<string, unknown>, columnKey: string) => {
      const columnIndex = colIndexFromKey(columnKey)
      const column = columns[columnIndex]
      const descriptor = gridColumns[columnIndex]
      if (!column || !descriptor?.isBinary) return

      const cellValue = row[columnKey]
      setBlobContext({
        rowIndex: typeof row.__rowIdx === 'number' ? row.__rowIdx : -1,
        row: toCachedRow(row, columns.length),
        columnIndex,
        columnLabel: column.name,
        base64: typeof cellValue === 'string' ? cellValue : null,
        editable: descriptor.blobViewerEditable === true,
      })
      setBlobDialogOpen(true)
    },
    [columns, gridColumns]
  )

  const handleBlobApply = useCallback(
    (envelope: BlobEnvelope) => {
      if (!blobContext?.editable) return
      if (blobContext.rowIndex >= 0 && editingRowIndex !== blobContext.rowIndex) {
        onStartEditing(blobContext.rowIndex, blobContext.row)
      }
      onSyncCellValue(blobContext.columnIndex, envelope)
    },
    [blobContext, editingRowIndex, onStartEditing, onSyncCellValue]
  )

  const editableColumnKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const [index, editable] of editableColumnMap) {
      if (editable) keys.add(colKey(index))
    }
    return keys
  }, [editableColumnMap])

  const selectedCellPosition = useMemo<GridCellPosition | null>(() => {
    if (selectedRowIndex == null || !selectedCell) {
      return selectedRowIndex == null ? null : { rowIdx: selectedRowIndex, idx: 0 }
    }
    const idx = columns.findIndex((column) => column.name === selectedCell.columnKey)
    return { rowIdx: selectedRowIndex, idx: idx >= 0 ? idx : 0 }
  }, [columns, selectedCell, selectedRowIndex])

  const handleSelectedCellChange = useCallback(
    (pos: GridCellPosition) => {
      const row = rowSourceRef.current.getRow(pos.rowIdx)
      const column = columnsRef.current[pos.idx]
      if (!row || !column) return
      syncSelection(pos.rowIdx, colKey(pos.idx), row)
    },
    [syncSelection]
  )

  // ---------------------------------------------------------------------------
  // Sort state: translate between app (lowercase, real names) and BaseGridView
  // (uppercase, col_N keys).
  // ---------------------------------------------------------------------------
  const sortColumnKey = useMemo(() => {
    if (sortColumn && sortDirection) {
      const colIdx = columns.findIndex((c) => c.name === sortColumn)
      if (colIdx >= 0) return colKey(colIdx)
    }
    return null
  }, [sortColumn, sortDirection, columns])

  const sortDirectionUpper = useMemo(() => {
    if (sortDirection) return sortDirection.toUpperCase() as 'ASC' | 'DESC'
    return null
  }, [sortDirection])

  const handleSortChange = useCallback(
    (colKey_: string | null, direction: 'ASC' | 'DESC' | null) => {
      if (!colKey_) {
        // Sort was cleared — pass the previously sorted column with null direction.
        // The store's sortResults action handles the cache-only guard and shows
        // a warning toast when the result is not re-executable.
        if (sortColumn) {
          onSortChanged(sortColumn, null)
        }
        return
      }
      const colIndex = colIndexFromKey(colKey_)
      const colName = columns[colIndex]?.name
      if (colName) {
        const dir = direction ? (direction.toLowerCase() as 'asc' | 'desc') : null
        onSortChanged(colName, dir)
      }
    },
    [columns, sortColumn, onSortChanged]
  )

  // ---------------------------------------------------------------------------
  // Adapt rich RowEditState (schema.ts) to simple RowEditState (shared-data-view.ts).
  // Values are keyed by col_N in the shared version.
  // ---------------------------------------------------------------------------
  const sharedEditState: SharedRowEditState | null = useMemo(() => {
    if (!editState) return null
    // Build a col_N-keyed currentValues/originalValues for BaseGridView
    const currentValues: Record<string, unknown> = {}
    const originalValues: Record<string, unknown> = {}
    for (const [colName, value] of Object.entries(editState.currentValues)) {
      const colIdx = boundColumnIndexLookup.get(colName) ?? -1
      if (colIdx !== -1) {
        currentValues[colKey(colIdx)] = value
      }
    }
    for (const [colName, value] of Object.entries(editState.originalValues)) {
      const colIdx = boundColumnIndexLookup.get(colName) ?? -1
      if (colIdx !== -1) {
        originalValues[colKey(colIdx)] = value
      }
    }
    // Use a serialised rowKey string
    const rowKey =
      typeof editState.rowKey === 'object'
        ? JSON.stringify(editState.rowKey)
        : String(editState.rowKey)
    return { rowKey, currentValues, originalValues }
  }, [editState, boundColumnIndexLookup])

  // ---------------------------------------------------------------------------
  // isModifiedCell: detect modified cells using the rich editState.
  // ---------------------------------------------------------------------------
  const isModifiedCell = useCallback(
    (rowData: Record<string, unknown>, columnKey: string) => {
      if (!editMode) return false
      const currentEditState = editStateRef.current
      const currentEditingRowIndex = editingRowIndexRef.current
      if (!currentEditState || currentEditingRowIndex === null) return false

      if (!isEditingRowData(rowData, currentEditingRowIndex, editingBaseIndexRef.current)) {
        return false
      }

      // Only bound source columns can be considered modified query-edit fields.
      const colIndex = colIndexFromKey(columnKey)
      const boundName = editColumnBindings.get(colIndex)
      if (!boundName) return false

      return currentEditState.modifiedColumns.has(boundName)
    },
    [editMode, editColumnBindings]
  )

  const autoSaveBeforeLeavingEditedRow = useCallback(
    async (targetRowIndex: number): Promise<boolean> => {
      const currentEditingRow = editingRowIndexRef.current
      if (currentEditingRow === null || currentEditingRow === targetRowIndex) return true

      const currentEditState = editStateRef.current
      if (!currentEditState || currentEditState.modifiedColumns.size === 0) return true

      return onAutoSave()
    },
    [onAutoSave]
  )

  // ---------------------------------------------------------------------------
  // Cell click guard: handles row selection, auto-save, and edit initiation.
  // ---------------------------------------------------------------------------
  const cellClickGuard = useMemo(() => {
    if (!editMode) return undefined

    return async (args: CellClickGuardArgs): Promise<CellClickGuardResult> => {
      const { rowIdx, columnKey } = args
      const isKeyboardNavigation = args.source === 'keyboard'
      const isKeyboardTyping = args.source === 'keyboard-typing'

      const colIndex = colIndexFromKey(columnKey)
      const isEditable = editableColumnMap.get(colIndex) ?? false

      // Determine target column index for selectCell
      const targetColIdx = colIndexFromKey(columnKey)

      // Run async guard (save, validate) if switching rows
      const currentEditingRow = editingRowIndexRef.current
      const saveSucceeded = await autoSaveBeforeLeavingEditedRow(rowIdx)
      if (!saveSucceeded) {
        return {
          proceed: false,
          targetRowIdx: currentEditingRow ?? rowIdx,
          targetColIdx,
          enableEditor: !isKeyboardNavigation,
          restoreFocus: true,
        }
      }

      syncSelection(rowIdx, columnKey, args.rowData)

      // Editable cells should start row editing; pointer single-click still keeps the editor closed.
      if (isEditable) {
        if (currentEditingRow !== rowIdx) {
          onStartEditing(rowIdx, toCachedRow(args.rowData, columnsRef.current.length))
        }
        return {
          proceed: true,
          targetRowIdx: rowIdx,
          targetColIdx,
          enableEditor: isKeyboardTyping,
        }
      }

      // Non-editable column: select but don't edit
      return {
        proceed: true,
        targetRowIdx: rowIdx,
        targetColIdx,
        enableEditor: false,
      }
    }
  }, [autoSaveBeforeLeavingEditedRow, editMode, editableColumnMap, onStartEditing, syncSelection])

  // In read-only mode, we still need a simple cell click handler for row selection.
  // BaseGridView only calls onCellClickGuard when row-change validation is needed.
  // applies (no row selection callback). So for read-only mode we provide a minimal guard.
  const readOnlyCellClickGuard = useCallback(
    async (args: CellClickGuardArgs): Promise<CellClickGuardResult> => {
      syncSelection(args.rowIdx, args.columnKey, args.rowData)

      // Allow selectCell so the cell gets focus/selection, but don't open an editor
      const targetColIdx = colIndexFromKey(args.columnKey)
      return {
        proceed: true,
        targetRowIdx: args.rowIdx,
        targetColIdx: targetColIdx >= 0 ? targetColIdx : 0,
        enableEditor: false,
      }
    },
    [syncSelection]
  )

  const autoSizeConfig: AutoSizeConfig | undefined = useMemo(() => {
    return {
      enabled: true,
      computeWidth: (col, gridRows) => {
        const index = colIndexFromKey(col.key)
        const tableMeta = resolvedColumns[index]?.effectiveTableMeta
        if (!tableMeta) return 150
        // Build a lightweight proxy array that extracts only the target column
        // from the sampled rows; getAutoSizedColumnWidth reads no further.
        const sampleCount = Math.min(gridRows.length, AUTO_SIZE_SAMPLE_LIMIT)
        const columnRows: unknown[][] = new Array(sampleCount)
        for (let i = 0; i < sampleCount; i++) {
          columnRows[i] = [gridRows[i][colKey(index)]]
        }
        // Read-only headers show a lock icon except for BLOB columns that
        // remain editable through the shared viewer.
        const isEditable = editableColumnMap.get(index) ?? false
        const blobViewerEditable =
          resolvedColumns[index]?.effectiveTableMeta.isBinary === true &&
          editMode !== null &&
          editColumnBindings.has(index)
        const headerIconWidthPx = !isEditable && !blobViewerEditable ? 14 : 0
        return getAutoSizedColumnWidth(
          tableMeta,
          0, // column is at index 0 in our single-column proxy array
          columnRows,
          col.displayName,
          headerIconWidthPx
        )
      },
    }
  }, [editColumnBindings, editMode, editableColumnMap, resolvedColumns])

  const handleCellClipboardEdit = useCallback(
    async (args: CellClipboardEditArgs): Promise<boolean> => {
      if (!editMode) return false

      const colIndex = colIndexFromKey(args.columnKey)
      const isEditable = editableColumnMap.get(colIndex) ?? false
      if (!columns[colIndex] || !isEditable) return false

      const currentEditingRow = editingRowIndexRef.current
      const saveSucceeded = await autoSaveBeforeLeavingEditedRow(args.rowIdx)
      if (!saveSucceeded) return false

      syncSelection(args.rowIdx, args.columnKey, args.rowData)

      if (currentEditingRow !== args.rowIdx) {
        onStartEditing(args.rowIdx, toCachedRow(args.rowData, columns.length))
      }

      const nextValue =
        args.action === 'cut'
          ? null
          : (args.text ?? (args.rowData[args.columnKey] as string | null))
      onSyncCellValue(colIndex, nextValue)
      return true
    },
    [
      editMode,
      columns,
      editableColumnMap,
      autoSaveBeforeLeavingEditedRow,
      onStartEditing,
      onSyncCellValue,
      syncSelection,
    ]
  )

  // ---------------------------------------------------------------------------
  // Row key getter: return string for BaseGridView compatibility.
  // ---------------------------------------------------------------------------
  const rowKeyGetter = useCallback((row: Record<string, unknown>) => String(row.__rowIdx), [])

  // ---------------------------------------------------------------------------
  // Row class: editing row + selected row highlight.
  // ---------------------------------------------------------------------------
  const getRowClass = useCallback(
    (row: Record<string, unknown>) => {
      const rowIdx = row.__rowIdx as number
      const classes: string[] = []

      // Editing row highlight (by base index: a sort or filter may move the row)
      if (isEditingRowData(row, editingRowIndex, editingBaseIndex)) {
        classes.push('grid-editing-row')
      }

      // Selected row highlight
      if (selectedRowIndex != null && rowIdx === selectedRowIndex) {
        classes.push('grid-row-precision-selected')
      }

      return classes.length > 0 ? classes.join(' ') : undefined
    },
    [selectedRowIndex, editingRowIndex, editingBaseIndex]
  )

  return (
    <EditorCallbacksContext.Provider value={editorCallbacksCtx}>
      <CanvasBaseGridView
        rows={EMPTY_ROWS}
        rowSource={rowSource}
        rowActions={rowActions}
        columns={gridColumns}
        editState={sharedEditState}
        sortColumn={sortColumnKey}
        sortDirection={sortDirectionUpper}
        onSortChange={handleSortChange}
        onCellClickGuard={editMode ? cellClickGuard : readOnlyCellClickGuard}
        onCellSelectionChange={!editMode ? handleCellSelectionChange : undefined}
        runCellClickGuardOnKeyboardSelection={!!editMode}
        onCellClipboardEdit={handleCellClipboardEdit}
        onCellDoubleClick={handleCellDoubleClick}
        selectedCellPosition={selectedCellPosition}
        onSelectedCellChange={handleSelectedCellChange}
        isEditMode={!!editMode}
        editableColumnKeys={editableColumnKeys}
        onCellValueChange={(rowIdx, columnKey, newValue) => {
          void rowIdx
          const colIndex = colIndexFromKey(columnKey)
          if (colIndex >= 0) onSyncCellValue(colIndex, newValue)
        }}
        onRowChanging={async (_from, _to) => {
          return autoSaveBeforeLeavingEditedRow(_to)
        }}
        rowKeyGetter={rowKeyGetter}
        getRowClass={getRowClass}
        selectedRowIndex={selectedRowIndex}
        selectedRowClassName={!editMode ? 'grid-row-precision-selected' : undefined}
        isModifiedCell={isModifiedCell}
        autoSizeConfig={autoSizeConfig}
        showReadOnlyHeaders={!!editMode}
        isActive={isActive}
        onScrollCellChange={handleScrollCellChange}
        initialScrollCell={initialScrollCell}
        rowMarkers="checkbox"
        onRowMarkerRangesChange={handleRowMarkerRangesChange}
        resetSelectionKey={resetSelectionKey}
        testId="result-grid"
      />
      {blobDialogOpen && blobContext && (
        <BlobViewerDialog
          isOpen={blobDialogOpen}
          onClose={closeBlobDialog}
          mode={blobContext.editable ? 'edit' : 'view'}
          columnLabel={blobContext.columnLabel}
          initialBase64={blobContext.base64}
          onApply={blobContext.editable ? handleBlobApply : undefined}
        />
      )}
    </EditorCallbacksContext.Provider>
  )
}
