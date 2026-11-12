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
import { QueryResultBlobDialog, type QueryResultBlobContext } from './QueryResultBlobDialog'
import { isBinaryDataType } from '../../lib/blob-utils'
import type { BlobEnvelope } from '../../types/schema'
import {
  EditorCallbacksContext,
  type EditorCallbacksContextType,
} from '../shared/editor-callbacks-context'
import { columnKey, columnIndexFromKey } from '../../lib/col-key-utils'
import {
  AUTO_SIZE_SAMPLE_LIMIT,
  getAutoSizedColumnWidth,
  DEFAULT_COLUMN_WIDTH_PX,
  HEADER_ICON_WIDTH_PX,
} from '../../lib/grid-column-style'
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

const EMPTY_FOREIGN_KEYS: import('../../types/schema').ForeignKeyColumnInfo[] = []
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

type ResolvedResultColumn = ReturnType<typeof resolveQueryResultColumns>[number]

function resolveEditorType(
  meta: TableDataColumnMeta | undefined
): GridColumnDescriptor['editorType'] {
  if (!meta) return 'none'
  if (meta.enumValues?.length) return 'enum'
  if (isJsonSqlType(meta.dataType)) return 'json'
  if (meta.setValues?.length) return 'set'
  return 'text'
}

function resultColumnKeyFlags(meta: TableDataColumnMeta | undefined) {
  return {
    isNullable: meta?.isNullable ?? true,
    isPrimaryKey: meta?.isPrimaryKey ?? false,
    isUniqueKey: meta?.isUniqueKey ?? false,
  }
}

interface ResultColumnContext {
  isEditing: boolean
  editColumnBindings: Map<number, string>
}

function toResultGridColumn(
  column: ResolvedResultColumn,
  columnIndex: number,
  context: ResultColumnContext
): GridColumnDescriptor {
  const meta = column.tableColumnMeta
  const isBlob = column.effectiveTableMeta.isBinary
  const isBoundForEdit = context.isEditing && context.editColumnBindings.has(columnIndex)
  return {
    key: column.key,
    displayName: column.displayName,
    dataType: column.dataType,
    editable: column.editable,
    isBinary: isBinaryDataType(column.dataType),
    blobViewer: isBlob,
    blobViewerEditable: isBlob && isBoundForEdit,
    ...resultColumnKeyFlags(meta),
    enumValues: meta?.enumValues,
    setValues: meta?.setValues,
    tableColumnMeta: column.editable ? meta : undefined,
    foreignKey: column.foreignKey,
    editorType: resolveEditorType(meta),
  }
}

const READ_ONLY_SELECTED_ROW_CLASS = 'grid-row-precision-selected'

interface GridBlobContext extends QueryResultBlobContext {
  rowIndex: number
  row: CachedRow
  columnIndex: number
}

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
  editMode,
  editableColumnMap,
  editState,
  editingRowIndex,
  editingBaseIndex,
  editTableColumns,
  editForeignKeys = EMPTY_FOREIGN_KEYS,
  editColumnBindings,
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
  const storeScrollColumn = useQueryStore((state) => {
    const tab = state.tabs[tabId]
    const activeResultIndex = tab?.activeResultIndex ?? 0
    return tab?.results[activeResultIndex]?.scrollCol ?? 0
  })
  const initialScrollCell = useMemo(
    () => ({ scrollRow: storeScrollRow, scrollCol: storeScrollColumn }),
    [storeScrollRow, storeScrollColumn]
  )

  const handleScrollCellChange = useCallback(
    (scrollRow: number, scrollColumn: number) => {
      storeSetResultScrollCell(tabId, scrollRow, scrollColumn)
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
  const [blobContext, setBlobContext] = useState<GridBlobContext | null>(null)

  const closeBlobDialog = useCallback(() => {
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
    const columnIndex = columnIndexFromKey(pendingSelection.columnKey)
    const column = columnsRef.current[columnIndex]

    onRowSelectedRef.current(pendingSelection.rowIdx)
    if (!column) return

    storeSetSelectedCellRef.current(tabId, {
      columnKey: column.name,
      value: pendingSelection.value,
    })
  }, [tabId])

  const scheduleReadOnlySelectionSync = useCallback(
    (rowIndex: number, columnKey: string, selectedRow: Record<string, unknown>) => {
      pendingReadOnlySelectionRef.current = {
        rowIdx: rowIndex,
        columnKey: columnKey,
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
    (rowIndex: number, columnKey: string, selectedRow: Record<string, unknown>) => {
      const nextValue = selectedRow[columnKey]
      const lastSelection = lastSyncedSelectionRef.current
      if (
        lastSelection?.rowIdx === rowIndex &&
        lastSelection.columnKey === columnKey &&
        Object.is(lastSelection.value, nextValue)
      ) {
        return
      }
      lastSyncedSelectionRef.current = { rowIdx: rowIndex, columnKey: columnKey, value: nextValue }
      onRowSelected(rowIndex)

      const columnIndex = columnIndexFromKey(columnKey)
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

  const editorCallbacksContext: EditorCallbacksContextType = useMemo(
    () => ({
      tabId: tabId,
      updateCellValue: (_tabId, columnKey, value) => {
        const columnIndex = columnIndexFromKey(columnKey)
        if (columnIndex >= 0) {
          onUpdateCellValue(columnIndex, value)
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
      for (const [columnName, value] of Object.entries(editState.currentValues)) {
        const columnIndex = boundColumnIndexLookup.get(columnName) ?? -1
        if (columnIndex !== -1) overlaid[columnKey(columnIndex)] = value
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
      getRow: getRow,
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
      editMode: editMode,
      editableColumnMap: editableColumnMap,
      editTableColumns: editTableColumns,
      editForeignKeys: editForeignKeys,
      editColumnBindings: editColumnBindings,
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
    const context = { isEditing: editMode !== null, editColumnBindings: editColumnBindings }
    return resolvedColumns.map((column, columnIndex) =>
      toResultGridColumn(column, columnIndex, context)
    )
  }, [editColumnBindings, editMode, resolvedColumns])

  const handleCellDoubleClick = useCallback(
    (row: Record<string, unknown>, columnKey: string) => {
      const columnIndex = columnIndexFromKey(columnKey)
      const column = columns[columnIndex]
      const descriptor = gridColumns[columnIndex]
      if (!column || !descriptor?.isBinary) return

      const cellValue = row[columnKey]
      setBlobContext({
        rowIndex: typeof row.__rowIdx === 'number' ? row.__rowIdx : -1,
        row: toCachedRow(row, columns.length),
        columnIndex: columnIndex,
        columnLabel: column.name,
        base64: typeof cellValue === 'string' ? cellValue : null,
        editable: descriptor.blobViewerEditable === true,
      })
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
      if (editable) keys.add(columnKey(index))
    }
    return keys
  }, [editableColumnMap])

  const selectedCellPosition = useMemo<GridCellPosition | null>(() => {
    if (selectedRowIndex == null || !selectedCell) {
      return selectedRowIndex == null ? null : { rowIdx: selectedRowIndex, idx: 0 }
    }
    const index = columns.findIndex((column) => column.name === selectedCell.columnKey)
    return { rowIdx: selectedRowIndex, idx: index >= 0 ? index : 0 }
  }, [columns, selectedCell, selectedRowIndex])

  const handleSelectedCellChange = useCallback(
    (position: GridCellPosition) => {
      const row = rowSourceRef.current.getRow(position.rowIdx)
      const column = columnsRef.current[position.idx]
      if (!row || !column) return
      syncSelection(position.rowIdx, columnKey(position.idx), row)
    },
    [syncSelection]
  )

  // ---------------------------------------------------------------------------
  // Sort state: translate between app (lowercase, real names) and BaseGridView
  // (uppercase, col_N keys).
  // ---------------------------------------------------------------------------
  const sortColumnKey = useMemo(() => {
    if (sortColumn && sortDirection) {
      const columnIndex = columns.findIndex((column) => column.name === sortColumn)
      if (columnIndex >= 0) return columnKey(columnIndex)
    }
    return null
  }, [sortColumn, sortDirection, columns])

  const sortDirectionUpper = useMemo(() => {
    if (sortDirection) return sortDirection.toUpperCase() as 'ASC' | 'DESC'
    return null
  }, [sortDirection])

  const handleSortChange = useCallback(
    (requestedColumnKey: string | null, direction: 'ASC' | 'DESC' | null) => {
      if (!requestedColumnKey) {
        // Sort was cleared — pass the previously sorted column with null direction.
        // The store's sortResults action handles the cache-only guard and shows
        // a warning toast when the result is not re-executable.
        if (sortColumn) {
          onSortChanged(sortColumn, null)
        }
        return
      }
      const columnIndex = columnIndexFromKey(requestedColumnKey)
      const columnName = columns[columnIndex]?.name
      if (columnName) {
        const requestedDirection = direction ? (direction.toLowerCase() as 'asc' | 'desc') : null
        onSortChanged(columnName, requestedDirection)
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
    for (const [columnName, value] of Object.entries(editState.currentValues)) {
      const columnIndex = boundColumnIndexLookup.get(columnName) ?? -1
      if (columnIndex !== -1) {
        currentValues[columnKey(columnIndex)] = value
      }
    }
    for (const [columnName, value] of Object.entries(editState.originalValues)) {
      const columnIndex = boundColumnIndexLookup.get(columnName) ?? -1
      if (columnIndex !== -1) {
        originalValues[columnKey(columnIndex)] = value
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
      const columnIndex = columnIndexFromKey(columnKey)
      const boundName = editColumnBindings.get(columnIndex)
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
      const { rowIdx: rowIndex, columnKey } = args
      const isKeyboardNavigation = args.source === 'keyboard'
      const isKeyboardTyping = args.source === 'keyboard-typing'

      const columnIndex = columnIndexFromKey(columnKey)
      const isEditable = editableColumnMap.get(columnIndex) ?? false

      // Determine target column index for selectCell
      const targetColumnIndex = columnIndexFromKey(columnKey)

      // Run async guard (save, validate) if switching rows
      const currentEditingRow = editingRowIndexRef.current
      const saveSucceeded = await autoSaveBeforeLeavingEditedRow(rowIndex)
      if (!saveSucceeded) {
        return {
          proceed: false,
          targetRowIdx: currentEditingRow ?? rowIndex,
          targetColIdx: targetColumnIndex,
          enableEditor: !isKeyboardNavigation,
          restoreFocus: true,
        }
      }

      syncSelection(rowIndex, columnKey, args.rowData)

      // Editable cells should start row editing; pointer single-click still keeps the editor closed.
      if (isEditable) {
        if (currentEditingRow !== rowIndex) {
          onStartEditing(rowIndex, toCachedRow(args.rowData, columnsRef.current.length))
        }
        return {
          proceed: true,
          targetRowIdx: rowIndex,
          targetColIdx: targetColumnIndex,
          enableEditor: isKeyboardTyping,
        }
      }

      // Non-editable column: select but don't edit
      return {
        proceed: true,
        targetRowIdx: rowIndex,
        targetColIdx: targetColumnIndex,
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
      const targetColumnIndex = columnIndexFromKey(args.columnKey)
      return {
        proceed: true,
        targetRowIdx: args.rowIdx,
        targetColIdx: targetColumnIndex >= 0 ? targetColumnIndex : 0,
        enableEditor: false,
      }
    },
    [syncSelection]
  )

  const autoSizeConfig: AutoSizeConfig | undefined = useMemo(() => {
    return {
      enabled: true,
      computeWidth: (column, gridRows) => {
        const index = columnIndexFromKey(column.key)
        const tableMeta = resolvedColumns[index]?.effectiveTableMeta
        if (!tableMeta) return DEFAULT_COLUMN_WIDTH_PX
        // Build a lightweight proxy array that extracts only the target column
        // from the sampled rows; getAutoSizedColumnWidth reads no further.
        const sampleCount = Math.min(gridRows.length, AUTO_SIZE_SAMPLE_LIMIT)
        const columnRows: unknown[][] = new Array(sampleCount)
        for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
          columnRows[sampleIndex] = [gridRows[sampleIndex][columnKey(index)]]
        }
        // Read-only headers show a lock icon except for BLOB columns that
        // remain editable through the shared viewer.
        const isEditable = editableColumnMap.get(index) ?? false
        const blobViewerEditable =
          resolvedColumns[index]?.effectiveTableMeta.isBinary === true &&
          editMode !== null &&
          editColumnBindings.has(index)
        const headerIconWidthPx = !isEditable && !blobViewerEditable ? HEADER_ICON_WIDTH_PX : 0
        return getAutoSizedColumnWidth(
          tableMeta,
          0, // column is at index 0 in our single-column proxy array
          columnRows,
          column.displayName,
          headerIconWidthPx
        )
      },
    }
  }, [editColumnBindings, editMode, editableColumnMap, resolvedColumns])

  const handleCellClipboardEdit = useCallback(
    async (args: CellClipboardEditArgs): Promise<boolean> => {
      if (!editMode) return false

      const columnIndex = columnIndexFromKey(args.columnKey)
      const isEditable = editableColumnMap.get(columnIndex) ?? false
      if (!columns[columnIndex] || !isEditable) return false

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
      onSyncCellValue(columnIndex, nextValue)
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
      const rowIndex = row.__rowIdx as number
      const classes: string[] = []

      // Editing row highlight (by base index: a sort or filter may move the row)
      if (isEditingRowData(row, editingRowIndex, editingBaseIndex)) {
        classes.push('grid-editing-row')
      }

      // Selected row highlight
      if (selectedRowIndex != null && rowIndex === selectedRowIndex) {
        classes.push('grid-row-precision-selected')
      }

      return classes.length > 0 ? classes.join(' ') : undefined
    },
    [selectedRowIndex, editingRowIndex, editingBaseIndex]
  )

  const isEditMode = Boolean(editMode)

  return (
    <EditorCallbacksContext.Provider value={editorCallbacksContext}>
      <CanvasBaseGridView
        rows={EMPTY_ROWS}
        rowSource={rowSource}
        rowActions={rowActions}
        columns={gridColumns}
        editState={sharedEditState}
        sortColumn={sortColumnKey}
        sortDirection={sortDirectionUpper}
        onSortChange={handleSortChange}
        onCellClickGuard={isEditMode ? cellClickGuard : readOnlyCellClickGuard}
        onCellSelectionChange={isEditMode ? undefined : handleCellSelectionChange}
        runCellClickGuardOnKeyboardSelection={isEditMode}
        isEditMode={isEditMode}
        selectedRowClassName={isEditMode ? undefined : READ_ONLY_SELECTED_ROW_CLASS}
        showReadOnlyHeaders={isEditMode}
        onCellClipboardEdit={handleCellClipboardEdit}
        onCellDoubleClick={handleCellDoubleClick}
        selectedCellPosition={selectedCellPosition}
        onSelectedCellChange={handleSelectedCellChange}
        editableColumnKeys={editableColumnKeys}
        onCellValueChange={(rowIndex, columnKey, newValue) => {
          void rowIndex
          const columnIndex = columnIndexFromKey(columnKey)
          if (columnIndex >= 0) onSyncCellValue(columnIndex, newValue)
        }}
        onRowChanging={async (_from, _to) => {
          return autoSaveBeforeLeavingEditedRow(_to)
        }}
        rowKeyGetter={rowKeyGetter}
        getRowClass={getRowClass}
        selectedRowIndex={selectedRowIndex}
        isModifiedCell={isModifiedCell}
        autoSizeConfig={autoSizeConfig}
        isActive={isActive}
        onScrollCellChange={handleScrollCellChange}
        initialScrollCell={initialScrollCell}
        rowMarkers="checkbox"
        onRowMarkerRangesChange={handleRowMarkerRangesChange}
        resetSelectionKey={resetSelectionKey}
        testId="result-grid"
      />
      <QueryResultBlobDialog
        blobContext={blobContext}
        onClose={closeBlobDialog}
        onApply={handleBlobApply}
      />
    </EditorCallbacksContext.Provider>
  )
}
