/**
 * ResultGridView — thin wrapper around the shared BaseGridView for query results.
 *
 * Responsibilities:
 * - Transforms array-of-arrays rows into keyed Record<string, unknown>[] with col_N keys
 * - Builds GridColumnDescriptor[] from ColumnMeta[] + editableColumnMap
 * - Translates col_N ↔ real column names in sort, cell click guard, and onRowsChange
 * - Adapts the rich RowEditState (schema.ts) to the simple RowEditState (shared-data-view.ts)
 * - Provides isModifiedCell and getRowClass callbacks
 *
 * The external props interface remains unchanged — ResultPanel.tsx does not need modification.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BaseGridView } from '../shared/BaseGridView'
import { buildColumnDescriptors } from '../table-data/table-data-grid-columns'
import {
  EditorCallbacksContext,
  type EditorCallbacksContextType,
} from '../shared/editor-callbacks-context'
import { colKey, colIndexFromKey } from '../../lib/col-key-utils'
import { getAutoSizedColumnWidth } from '../../lib/grid-column-style'
import {
  createGridPerformanceLogger,
  type GridPerformanceLogger,
} from '../../lib/grid-performance-logger'
import { logFrontend } from '../../lib/app-log-commands'
import {
  resolveQueryResultColumns,
  type ResolvedQueryResultColumn,
} from '../../lib/query-result-column-utils'
import type { ColumnMeta, TableDataColumnMeta, RowEditState } from '../../types/schema'
import { useQueryStore } from '../../stores/query-store'
import type {
  GridColumnDescriptor,
  RowEditState as SharedRowEditState,
  CellClickGuardArgs,
  CellClickGuardResult,
  CellClipboardEditArgs,
  AutoSizeConfig,
} from '../../types/shared-data-view'
import type { RowsChangeData } from 'react-data-grid'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Row data shape: col_0, col_1, ... plus __rowIdx for stable identification. */
type ResultRow = Record<string, unknown>

// ---------------------------------------------------------------------------
// ResultGridView
// ---------------------------------------------------------------------------

interface ResultGridViewProps {
  columns: ColumnMeta[]
  rows: unknown[][]
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
  /** Page-local row index of the editing row. */
  editingRowIndex: number | null
  /** Column metadata from the edit table (for cell editor selection). */
  editTableColumns: TableDataColumnMeta[]
  /** FK metadata from the edit table (single-column constraints only). */
  editForeignKeys?: import('../../types/schema').ForeignKeyColumnInfo[]
  /** Result column index → bound source-table column name. */
  editColumnBindings: Map<number, string>
  /** Start editing a row by its page-local index. */
  onStartEditing: (rowIndex: number) => void
  /** Update a cell value in the edit state (result column index). */
  onUpdateCellValue: (columnIndex: number, value: unknown) => void
  /** Sync a cell value to both edit state and local rows. */
  onSyncCellValue: (columnIndex: number, value: unknown) => void
  /** Auto-save the current editing row (called on row transition). */
  onAutoSave: () => Promise<boolean>
}

const EMPTY_EDITABLE_MAP = new Map<number, boolean>()
const EMPTY_TABLE_COLUMNS: TableDataColumnMeta[] = []
const EMPTY_FOREIGN_KEYS: import('../../types/schema').ForeignKeyColumnInfo[] = []
const EMPTY_BINDINGS = new Map<number, string>()
const READ_ONLY_SELECTION_SYNC_DELAY_MS = 75
const RESULT_GRID_PERF_SCOPE = 'query-result-grid'
const SLOW_RESULT_RENDER_COMMIT_MS = 50
const SLOW_RESULT_DERIVATION_MS = 16
const ENABLE_QUERY_RESULT_PARITY_LITE_DIAGNOSTIC = true
const QUERY_RESULT_GRID_DIAGNOSTIC_MODE = 'parity-lite'
const READ_ONLY_DIAGNOSTIC_FLAGS = {
  bypassColumnResolution: true,
  disableSelectionSync: true,
  disableImperativeRowHighlight: true,
} as const
const ENABLE_QUERY_RESULT_TABLE_DATA_SHAPE_DIAGNOSTIC = true
const QUERY_RESULT_TABLE_DATA_SHAPE_DIAGNOSTIC_MODE = 'table-data-shape'

function readPerformanceNow(): number {
  return globalThis.performance?.now() ?? Date.now()
}

function readNavigatorPlatform(): string {
  return globalThis.navigator?.platform ?? 'unknown'
}

function buildTableShapeColumnMeta(column: ColumnMeta): TableDataColumnMeta {
  return {
    name: column.name,
    dataType: column.dataType,
    isNullable: true,
    isPrimaryKey: false,
    isUniqueKey: false,
    hasDefault: false,
    columnDefault: null,
    isBinary: false,
    isBooleanAlias: false,
    isAutoIncrement: false,
  }
}

function readResultRowIndex(row: Record<string, unknown>): number {
  const index = row.__rowIndex ?? row.__rowIdx
  return typeof index === 'number' ? index : -1
}

export function ResultGridView({
  columns,
  rows,
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
  editTableColumns = EMPTY_TABLE_COLUMNS,
  editForeignKeys = EMPTY_FOREIGN_KEYS,
  editColumnBindings = EMPTY_BINDINGS,
  onStartEditing,
  onUpdateCellValue,
  onSyncCellValue,
  onAutoSave,
}: ResultGridViewProps) {
  const renderStartedAt = readPerformanceNow()
  const storeSetSelectedCell = useQueryStore((state) => state.setSelectedCell)
  const isReadOnlyDiagnosticMode =
    ENABLE_QUERY_RESULT_PARITY_LITE_DIAGNOSTIC && editMode === null
  const diagnosticFlags = isReadOnlyDiagnosticMode ? READ_ONLY_DIAGNOSTIC_FLAGS : null
  const useTableDataShapeDiagnostic =
    ENABLE_QUERY_RESULT_TABLE_DATA_SHAPE_DIAGNOSTIC &&
    editMode === null &&
    readNavigatorPlatform() === 'MacIntel'
  const disableReadOnlyCellStylesDiagnostic = useTableDataShapeDiagnostic

  // Refs for stable access in callbacks without re-creating them
  const editStateRef = useRef(editState)
  const editingRowIndexRef = useRef(editingRowIndex)
  const rowDataRef = useRef<ResultRow[]>([])
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
  const performanceContext = useMemo(
    () => ({
      scope: RESULT_GRID_PERF_SCOPE,
      tabId,
      view: 'grid',
      rows: rows.length,
      columns: columns.length,
      editMode,
    }),
    [columns.length, editMode, rows.length, tabId]
  )
  const [performanceLogger] = useState<GridPerformanceLogger>(() =>
    createGridPerformanceLogger(performanceContext)
  )

  useEffect(() => {
    performanceLogger.updateContext(performanceContext)
  }, [performanceContext, performanceLogger])

  useEffect(() => {
    performanceLogger.logMount()
    if (diagnosticFlags) {
      logFrontend(
        'info',
        `[query-result-grid-debug] mode=${QUERY_RESULT_GRID_DIAGNOSTIC_MODE} tabId=${tabId} ` +
          `disableSelectionSync=${diagnosticFlags.disableSelectionSync} ` +
          `disableImperativeRowHighlight=${diagnosticFlags.disableImperativeRowHighlight} ` +
          `bypassColumnResolution=${diagnosticFlags.bypassColumnResolution}`
      )
    }
    if (useTableDataShapeDiagnostic) {
      logFrontend(
        'info',
        `[query-result-grid-debug] mode=${QUERY_RESULT_TABLE_DATA_SHAPE_DIAGNOSTIC_MODE} ` +
          `tabId=${tabId} keyStrategy=native-column-names rowIndexKey=__rowIndex ` +
          `editableVisuals=true writesEnabled=false`
      )
    }
    return () => {
      performanceLogger.flush('unmount')
    }
  }, [diagnosticFlags, performanceLogger, tabId, useTableDataShapeDiagnostic])

  useEffect(() => {
    performanceLogger.recordTiming('result-render-commit', readPerformanceNow() - renderStartedAt, {
      thresholdMs: SLOW_RESULT_RENDER_COMMIT_MS,
    })
  })

  useEffect(() => {
    editStateRef.current = editState
  }, [editState])

  useEffect(() => {
    editingRowIndexRef.current = editingRowIndex
  }, [editingRowIndex])

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
  }, [rows, columns, tabId])

  useEffect(() => {
    return () => {
      if (readOnlySelectionSyncTimerRef.current) {
        clearTimeout(readOnlySelectionSyncTimerRef.current)
      }
    }
  }, [])

  const flushPendingReadOnlySelection = useCallback(() => {
    const startedAt = readPerformanceNow()
    readOnlySelectionSyncTimerRef.current = null
    const pendingSelection = pendingReadOnlySelectionRef.current
    if (!pendingSelection) return

    pendingReadOnlySelectionRef.current = null
    const columnIndex = colIndexFromKey(pendingSelection.columnKey)
    const column = useTableDataShapeDiagnostic
      ? columnsRef.current.find((candidate) => candidate.name === pendingSelection.columnKey)
      : columnsRef.current[columnIndex]

    onRowSelectedRef.current(pendingSelection.rowIdx)
    if (!column) return

    storeSetSelectedCellRef.current(tabId, {
      columnKey: column.name,
      value: pendingSelection.value,
    })
    performanceLogger.recordTiming(
      'result-readonly-selection-flush',
      readPerformanceNow() - startedAt,
      {
        thresholdMs: SLOW_RESULT_DERIVATION_MS,
      }
    )
  }, [performanceLogger, tabId])

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
      performanceLogger.increment('result-readonly-selection-scheduled')
    },
    [flushPendingReadOnlySelection, performanceLogger]
  )

  const syncSelection = useCallback(
    (rowIdx: number, columnKey: string, selectedRow: Record<string, unknown>) => {
      const startedAt = readPerformanceNow()
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

      const column = useTableDataShapeDiagnostic
        ? columns.find((candidate) => candidate.name === columnKey)
        : columns[colIndexFromKey(columnKey)]
      if (!column) return

      storeSetSelectedCell(tabId, {
        columnKey: column.name,
        value: nextValue,
      })
      performanceLogger.recordTiming('result-selection-sync', readPerformanceNow() - startedAt, {
        thresholdMs: SLOW_RESULT_DERIVATION_MS,
      })
    },
    [columns, onRowSelected, performanceLogger, storeSetSelectedCell, tabId, useTableDataShapeDiagnostic]
  )

  const handleCellSelectionChange = useCallback(
    (args: CellClickGuardArgs) => {
      if (diagnosticFlags?.disableSelectionSync) return
      scheduleReadOnlySelectionSync(args.rowIdx, args.columnKey, args.rowData)
    },
    [diagnosticFlags, scheduleReadOnlySelectionSync]
  )

  const editorCallbacksCtx: EditorCallbacksContextType = useMemo(
    () => ({
      tabId,
      updateCellValue: (_tabId, columnKey, value) => {
        const colIndex = useTableDataShapeDiagnostic
          ? columns.findIndex((column) => column.name === columnKey)
          : colIndexFromKey(columnKey)
        if (colIndex >= 0) {
          onUpdateCellValue(colIndex, value)
        }
      },
      syncCellValue: () => {},
    }),
    [columns, onUpdateCellValue, tabId, useTableDataShapeDiagnostic]
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
  // Row data: transform array-of-arrays to array-of-objects with col_N keys.
  // Overlays editState current values on the editing row.
  // ---------------------------------------------------------------------------
  const rowDataBuild = useMemo(() => {
    const startedAt = readPerformanceNow()
    const materializedRows = rows.map((row, rowIdx) => {
      const obj: ResultRow = { __rowIdx: rowIdx }
      columns.forEach((_, i) => {
        const key = useTableDataShapeDiagnostic ? columns[i].name : colKey(i)
        obj[key] = row[i] ?? null
      })
      if (useTableDataShapeDiagnostic) {
        obj.__rowIndex = rowIdx
        delete obj.__rowIdx
      }

      if (editState && editingRowIndex !== null && rowIdx === editingRowIndex) {
        for (const [colName, value] of Object.entries(editState.currentValues)) {
          const colIdx = boundColumnIndexLookup.get(colName) ?? -1
          if (colIdx !== -1) {
            const key = useTableDataShapeDiagnostic ? columns[colIdx]?.name : colKey(colIdx)
            if (key) {
              obj[key] = value
            }
          }
        }
      }

      return obj
    })
    return {
      rows: materializedRows,
      durationMs: readPerformanceNow() - startedAt,
    }
  }, [rows, columns, editState, editingRowIndex, boundColumnIndexLookup, useTableDataShapeDiagnostic])
  const rowData: ResultRow[] = rowDataBuild.rows

  useEffect(() => {
    performanceLogger.recordTiming('result-row-materialize', rowDataBuild.durationMs, {
      thresholdMs: SLOW_RESULT_DERIVATION_MS,
      fields: {
        sourceRows: rows.length,
        sourceColumns: columns.length,
      },
    })
  }, [columns.length, performanceLogger, rowDataBuild.durationMs, rows.length])

  // Keep rowDataRef in sync for stable callbacks
  useEffect(() => {
    rowDataRef.current = rowData
  }, [rowData])

  const resolvedColumnsBuild = useMemo(() => {
    const startedAt = readPerformanceNow()
    const resolved: ResolvedQueryResultColumn[] =
      diagnosticFlags?.bypassColumnResolution
        ? columns.map((resultColumn, index) => ({
            key: useTableDataShapeDiagnostic ? resultColumn.name : colKey(index),
            displayName: resultColumn.name,
            dataType: resultColumn.dataType,
            boundName: resultColumn.name,
            editable: false,
            tableColumnMeta: undefined,
            effectiveTableMeta: {
              name: resultColumn.name,
              dataType: resultColumn.dataType,
              isNullable: true,
              isPrimaryKey: false,
              isUniqueKey: false,
              hasDefault: false,
              columnDefault: null,
              isBinary: false,
              isBooleanAlias: false,
              isAutoIncrement: false,
            },
            foreignKey: undefined,
          }))
        : resolveQueryResultColumns({
            resultColumns: columns,
            editMode,
            editableColumnMap,
            editTableColumns,
            editForeignKeys,
            editColumnBindings,
          })
    return {
      columns: resolved,
      durationMs: readPerformanceNow() - startedAt,
    }
  }, [
    columns,
    diagnosticFlags?.bypassColumnResolution,
    editMode,
    editableColumnMap,
    editTableColumns,
    editForeignKeys,
    editColumnBindings,
    useTableDataShapeDiagnostic,
  ])
  const resolvedColumns = resolvedColumnsBuild.columns

  useEffect(() => {
    performanceLogger.recordTiming('result-column-resolve', resolvedColumnsBuild.durationMs, {
      thresholdMs: SLOW_RESULT_DERIVATION_MS,
    })
  }, [performanceLogger, resolvedColumnsBuild.durationMs])

  // ---------------------------------------------------------------------------
  // Column descriptors: build GridColumnDescriptor[] from ColumnMeta[].
  // ---------------------------------------------------------------------------
  const gridColumns: GridColumnDescriptor[] = useMemo(() => {
    if (useTableDataShapeDiagnostic) {
      return buildColumnDescriptors(
        columns.map((column) => buildTableShapeColumnMeta(column)),
        false,
        true
      ).map((column) => ({
        ...column,
        editable: true,
        tableColumnMeta: undefined,
        foreignKey: undefined,
      }))
    }
    return resolvedColumns.map((column) => {
      return {
        key: column.key,
        displayName: column.displayName,
        dataType: column.dataType,
        editable: column.editable,
        isBinary: false,
        isNullable: column.tableColumnMeta?.isNullable ?? true,
        isPrimaryKey: column.tableColumnMeta?.isPrimaryKey ?? false,
        isUniqueKey: column.tableColumnMeta?.isUniqueKey ?? false,
        enumValues: column.tableColumnMeta?.enumValues,
        tableColumnMeta: column.editable ? column.tableColumnMeta : undefined,
        foreignKey: column.foreignKey,
      }
    })
  }, [columns, resolvedColumns, useTableDataShapeDiagnostic])

  // ---------------------------------------------------------------------------
  // Sort state: translate between app (lowercase, real names) and BaseGridView
  // (uppercase, col_N keys).
  // ---------------------------------------------------------------------------
  const sortColumnKey = useMemo(() => {
    if (sortColumn && sortDirection) {
      if (useTableDataShapeDiagnostic) return sortColumn
      const colIdx = columns.findIndex((c) => c.name === sortColumn)
      if (colIdx >= 0) return colKey(colIdx)
    }
    return null
  }, [sortColumn, sortDirection, columns, useTableDataShapeDiagnostic])

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
      const dir = direction ? (direction.toLowerCase() as 'asc' | 'desc') : null
      if (useTableDataShapeDiagnostic) {
        onSortChanged(colKey_, dir)
        return
      }
      const colIndex = colIndexFromKey(colKey_)
      const colName = columns[colIndex]?.name
      if (colName) {
        onSortChanged(colName, dir)
      }
    },
    [columns, sortColumn, onSortChanged, useTableDataShapeDiagnostic]
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

      const rowIdx = rowData.__rowIdx as number
      if (rowIdx !== currentEditingRowIndex) return false

      // Only bound source columns can be considered modified query-edit fields.
      const colIndex = useTableDataShapeDiagnostic
        ? columns.findIndex((column) => column.name === columnKey)
        : colIndexFromKey(columnKey)
      const boundName = editColumnBindings.get(colIndex)
      if (!boundName) return false

      return currentEditState.modifiedColumns.has(boundName)
    },
    [columns, editMode, editColumnBindings, useTableDataShapeDiagnostic]
  )

  // ---------------------------------------------------------------------------
  // Cell click guard: handles row selection, auto-save, and edit initiation.
  // ---------------------------------------------------------------------------
  const cellClickGuard = useMemo(() => {
    if (!editMode) return undefined

    return async (args: CellClickGuardArgs): Promise<CellClickGuardResult> => {
      const { rowIdx, columnKey } = args

      const colIndex = useTableDataShapeDiagnostic
        ? columns.findIndex((column) => column.name === columnKey)
        : colIndexFromKey(columnKey)
      const isEditable = editableColumnMap.get(colIndex) ?? false

      // Determine target column index for selectCell
      const targetColIdx = colIndex

      // Run async guard (save, validate) if switching rows
      const currentEditingRow = editingRowIndexRef.current
      const currentEditState = editStateRef.current
      if (currentEditingRow !== null && currentEditingRow !== rowIdx) {
        if (currentEditState && currentEditState.modifiedColumns.size > 0) {
          const saveSucceeded = await onAutoSave()
          if (!saveSucceeded) {
            return {
              proceed: false,
              targetRowIdx: currentEditingRow,
              targetColIdx,
              enableEditor: true,
              restoreFocus: true,
            }
          }
        }
      }

      syncSelection(rowIdx, columnKey, args.rowData)

      // Only start editing and enter editor for editable columns
      if (isEditable) {
        if (currentEditingRow !== rowIdx) {
          onStartEditing(rowIdx)
        }
        return { proceed: true, targetRowIdx: rowIdx, targetColIdx, enableEditor: true }
      }

      // Non-editable column: select but don't edit
      return { proceed: true, targetRowIdx: rowIdx, targetColIdx, enableEditor: false }
    }
  }, [
    columns,
    editMode,
    editableColumnMap,
    onAutoSave,
    onStartEditing,
    syncSelection,
    useTableDataShapeDiagnostic,
  ])

  // In read-only mode, we still need a simple cell click handler for row selection.
  // BaseGridView only calls onCellClickGuard; when it's undefined, RDG default behavior
  // applies (no row selection callback). So for read-only mode we provide a minimal guard.
  const readOnlyCellClickGuard = useCallback(
    async (args: CellClickGuardArgs): Promise<CellClickGuardResult> => {
      syncSelection(args.rowIdx, args.columnKey, args.rowData)

      // Allow selectCell so the cell gets focus/selection, but don't open an editor
      const targetColIdx = useTableDataShapeDiagnostic
        ? columns.findIndex((column) => column.name === args.columnKey)
        : colIndexFromKey(args.columnKey)
      return {
        proceed: true,
        targetRowIdx: args.rowIdx,
        targetColIdx: targetColIdx >= 0 ? targetColIdx : 0,
        enableEditor: false,
      }
    },
    [columns, syncSelection, useTableDataShapeDiagnostic]
  )

  // ---------------------------------------------------------------------------
  // onRowsChange: handle cell editor updates via RDG's onRowChange protocol.
  // When a cell editor changes a value, RDG fires onRowsChange. We detect
  // which col_N changed and call onSyncCellValue with the real column name.
  // ---------------------------------------------------------------------------
  const handleRowsChange = useCallback(
    (newRows: Record<string, unknown>[], data: RowsChangeData<Record<string, unknown>>) => {
      const startedAt = readPerformanceNow()
      // data.indexes contains the indices of changed rows
      if (!data.indexes || data.indexes.length === 0) return

      const currentColumns = columnsRef.current
      const currentRowData = rowDataRef.current
      const syncCellValue = onSyncCellValueRef.current

      for (const changedIdx of data.indexes) {
        const newRow = newRows[changedIdx]
        const oldRow = currentRowData[changedIdx]
        if (!newRow || !oldRow) continue

        // Find which col_N value changed
        for (let i = 0; i < currentColumns.length; i++) {
          const key = useTableDataShapeDiagnostic ? currentColumns[i].name : colKey(i)
          if (newRow[key] !== oldRow[key]) {
            if (currentColumns[i]) {
              syncCellValue(i, newRow[key])
            }
          }
        }
      }
      performanceLogger.recordTiming('result-rows-change-scan', readPerformanceNow() - startedAt, {
        thresholdMs: SLOW_RESULT_DERIVATION_MS,
        fields: {
          changedRows: data.indexes.length,
          scannedColumns: currentColumns.length,
        },
      })
    },
    [performanceLogger, useTableDataShapeDiagnostic]
  )

  const autoSizeConfig: AutoSizeConfig | undefined = useMemo(() => {
    return {
      enabled: true,
      computeWidth: (col, gridRows) => {
        const index = useTableDataShapeDiagnostic
          ? columns.findIndex((column) => column.name === col.key)
          : colIndexFromKey(col.key)
        const tableMeta = resolvedColumns[index]?.effectiveTableMeta
        if (!tableMeta) return 150
        // Build a lightweight proxy array that extracts only the target column
        // from each row, avoiding the full row-to-array transformation that
        // previously created N temporary arrays per column.
        const columnRows: unknown[][] = new Array(gridRows.length)
        for (let i = 0; i < gridRows.length; i++) {
          const key = useTableDataShapeDiagnostic ? col.key : colKey(index)
          columnRows[i] = [gridRows[i][key]]
        }
        // Lock icon shown for non-editable columns in edit mode: 10px icon + 4px gap
        const isEditable = editableColumnMap.get(index) ?? false
        const headerIconWidthPx = !isEditable ? 14 : 0
        return getAutoSizedColumnWidth(
          tableMeta,
          0, // column is at index 0 in our single-column proxy array
          columnRows,
          col.displayName,
          headerIconWidthPx
        )
      },
    }
  }, [columns, editableColumnMap, resolvedColumns, useTableDataShapeDiagnostic])

  const handleCellClipboardEdit = useCallback(
    async (args: CellClipboardEditArgs) => {
      if (!editMode) return

      const colIndex = useTableDataShapeDiagnostic
        ? columns.findIndex((column) => column.name === args.columnKey)
        : colIndexFromKey(args.columnKey)
      const isEditable = editableColumnMap.get(colIndex) ?? false
      if (!columns[colIndex] || !isEditable) return

      const currentEditingRow = editingRowIndexRef.current
      const currentEditState = editStateRef.current
      if (currentEditingRow !== null && currentEditingRow !== args.rowIdx) {
        if (currentEditState && currentEditState.modifiedColumns.size > 0) {
          const saveSucceeded = await onAutoSave()
          if (!saveSucceeded) return
        }
      }

      syncSelection(args.rowIdx, args.columnKey, args.rowData)

      if (currentEditingRow !== args.rowIdx) {
        onStartEditing(args.rowIdx)
      }

      const nextValue =
        args.action === 'cut'
          ? null
          : (args.text ?? (args.rowData[args.columnKey] as string | null))
      onSyncCellValue(colIndex, nextValue)
    },
    [
      editMode,
      columns,
      editableColumnMap,
      onAutoSave,
      onStartEditing,
      onSyncCellValue,
      syncSelection,
      useTableDataShapeDiagnostic,
    ]
  )

  // ---------------------------------------------------------------------------
  // Row key getter: return string for BaseGridView compatibility.
  // ---------------------------------------------------------------------------
  const rowKeyGetter = useCallback(
    (row: Record<string, unknown>) =>
      String(useTableDataShapeDiagnostic ? row.__rowIndex : row.__rowIdx),
    [useTableDataShapeDiagnostic]
  )

  // ---------------------------------------------------------------------------
  // Row class: editing row + selected row highlight.
  // ---------------------------------------------------------------------------
  const getRowClass = useCallback(
    (row: Record<string, unknown>) => {
      const rowIdx = readResultRowIndex(row)
      const classes: string[] = []

      // Editing row highlight
      if (editingRowIndex !== null && rowIdx === editingRowIndex) {
        classes.push('rdg-editing-row')
      }

      // Selected row highlight
      if (selectedRowIndex != null && rowIdx === selectedRowIndex) {
        classes.push('rdg-row-precision-selected')
      }

      return classes.length > 0 ? classes.join(' ') : undefined
    },
    [selectedRowIndex, editingRowIndex]
  )

  return (
    <EditorCallbacksContext.Provider value={editorCallbacksCtx}>
      <BaseGridView
        rows={rowData}
        columns={gridColumns}
        editState={sharedEditState}
        sortColumn={sortColumnKey}
        sortDirection={sortDirectionUpper}
        onSortChange={handleSortChange}
        onCellClickGuard={editMode ? cellClickGuard : readOnlyCellClickGuard}
        onCellSelectionChange={
          !editMode && !diagnosticFlags?.disableSelectionSync
            ? handleCellSelectionChange
            : undefined
        }
        runCellClickGuardOnKeyboardSelection={useTableDataShapeDiagnostic ? true : !!editMode}
        onRowsChange={handleRowsChange}
        onCellClipboardEdit={handleCellClipboardEdit}
        rowKeyGetter={rowKeyGetter}
        getRowClass={getRowClass}
        selectedRowIndex={useTableDataShapeDiagnostic ? undefined : selectedRowIndex}
        selectedRowClassName={
          !editMode && !diagnosticFlags?.disableImperativeRowHighlight
            ? 'rdg-row-precision-selected'
            : undefined
        }
        isModifiedCell={isModifiedCell}
        applyReadOnlyCellStyles={!disableReadOnlyCellStylesDiagnostic}
        useCustomCellRenderer={true}
        useDefaultSortRenderer={true}
        autoSizeConfig={autoSizeConfig}
        showReadOnlyHeaders={!!editMode}
        performanceLogger={useTableDataShapeDiagnostic ? undefined : performanceLogger}
        testId="result-grid-view"
      />
    </EditorCallbacksContext.Provider>
  )
}
