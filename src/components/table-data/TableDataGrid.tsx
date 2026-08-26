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
import { FkLookupDialog } from './FkLookupDialog'
import { BlobViewerDialog } from '../dialogs/BlobViewerDialog'
import { fetchBlobValue } from '../../lib/table-data-commands'
import { buildEnvelopedPkPairs } from '../../lib/blob-utils'
import type { BlobEnvelope } from '../../types/schema'
import {
  useTableDataStore,
  isSameRowKey,
  findRowIndexByKey as findStoreRowIndexByKey,
  getRowKeyFromData,
} from '../../stores/table-data-store'
import { useToastStore } from '../../stores/toast-store'
import { getTemporalValidationResult } from '../../lib/table-data-save-utils'
import { getAutoSizedColumnWidth } from '../../lib/grid-column-style'
import type {
  GridColumnDescriptor,
  RowEditState as SharedRowEditState,
  CellClickGuardArgs,
  CellClickGuardResult,
  CellClipboardEditArgs,
  AutoSizeConfig,
} from '../../types/shared-data-view'
import type { TableDataColumnMeta, ForeignKeyColumnInfo } from '../../types/schema'
import { buildColumnDescriptors } from './table-data-grid-columns'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TableDataRow = Record<string, unknown>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRowKey(data: Record<string, unknown>, pkColumns: string[]): Record<string, unknown> {
  return getRowKeyFromData(data, pkColumns, { includeRowIndexFallback: true })
}

function findRowIndexByKey(
  rows: Record<string, unknown>[],
  targetKey: Record<string, unknown>,
  pkColumns: string[]
): number {
  return rows.findIndex((row) => isSameRowKey(getRowKey(row, pkColumns), targetKey))
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
  const stageBlobEnvelope = useTableDataStore((state) => state.stageBlobEnvelope)
  const setSelectedCell = useTableDataStore((state) => state.setSelectedCell)
  const columnJumpRequest = useTableDataStore((state) => state.columnJumpRequests[tabId])
  const highlightedColumnKey = useTableDataStore(
    (state) => state.highlightedColumnByTab[tabId] ?? null
  )
  const consumeColumnJump = useTableDataStore((state) => state.consumeColumnJump)
  const clearColumnHighlight = useTableDataStore((state) => state.clearColumnHighlight)
  const setScrollCell = useTableDataStore((state) => state.setScrollCell)
  const setColumnWidth = useTableDataStore((state) => state.setColumnWidth)
  const showError = useToastStore((state) => state.showError)
  const showSuccess = useToastStore((state) => state.showSuccess)

  const columns = useMemo(() => tabState?.columns ?? [], [tabState?.columns])
  const rows = useMemo(() => tabState?.rows ?? [], [tabState?.rows])
  const primaryKey = tabState?.primaryKey ?? null
  const editState = tabState?.editState ?? null
  const sort = tabState?.sort ?? null
  const selectedRowKey = tabState?.selectedRowKey ?? null
  const foreignKeys = useMemo(() => tabState?.foreignKeys ?? [], [tabState?.foreignKeys])
  const columnWidths = useMemo(() => tabState?.columnWidths ?? {}, [tabState?.columnWidths])

  const pkColumns = useMemo(() => primaryKey?.keyColumns ?? [], [primaryKey?.keyColumns])
  const hasPk = primaryKey !== null

  // ---------------------------------------------------------------------------
  // Scroll to newly inserted row at the bottom
  // ---------------------------------------------------------------------------
  const autoSelectedDraftTempIdRef = useRef<string | null>(null)
  useEffect(() => {
    const selectedDraftTempId =
      selectedRowKey && '__tempId' in selectedRowKey ? selectedRowKey.__tempId : null
    if (
      editState?.isNewRow &&
      selectedDraftTempId === editState.tempId &&
      rows.length > 0 &&
      autoSelectedDraftTempIdRef.current !== editState.tempId
    ) {
      const draftRowIdx = rows.length - 1
      autoSelectedDraftTempIdRef.current = editState.tempId ?? null
      requestAnimationFrame(() => {
        gridRef.current?.selectCell({ rowIdx: draftRowIdx, idx: 0 }, { shouldFocusCell: true })
      })
    }
    if (!editState?.isNewRow) {
      autoSelectedDraftTempIdRef.current = null
    }
  }, [editState?.isNewRow, editState?.tempId, rows.length, selectedRowKey])

  // ---------------------------------------------------------------------------
  // Scroll position: save on scroll, restore on mount/tab-switch
  // ---------------------------------------------------------------------------
  const handleScrollCellChange = useCallback(
    (scrollRow: number, scrollCol: number) => {
      setScrollCell(tabId, scrollRow, scrollCol)
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
        return getRowKey(row, pkColumns)
      })
      setCheckedRowKeys(tabId, keys)
    },
    [pkColumns, setCheckedRowKeys, tabId]
  )

  // When the store's checked set transitions from non-empty to empty (e.g. the
  // toolbar cleared it after a bulk delete), push a reset signal down to the
  // grid so its internal CompactSelection.rows checkmarks are cleared too.
  // Uses the documented "adjust state during render" pattern: track the
  // previous count in state and bump the reset key on the non-empty→empty
  // transition, so the signal is computed synchronously without an effect.
  const checkedRowCount = tabState?.checkedRowKeys?.length ?? 0
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
  const editorCallbacksCtx: EditorCallbacksContextType = useMemo(
    () => ({
      tabId,
      updateCellValue: storeUpdateCellValue,

      syncCellValue: () => {},
    }),
    [tabId, storeUpdateCellValue]
  )

  // ---------------------------------------------------------------------------
  // FK Lookup state — Phase 6B: opens the FkLookupDialog with context.
  // ---------------------------------------------------------------------------
  const [fkLookupOpen, setFkLookupOpen] = useState(false)
  const [fkLookupContext, setFkLookupContext] = useState<{
    columnKey: string
    currentValue: unknown
    foreignKey: ForeignKeyColumnInfo
    rowData: Record<string, unknown>
  } | null>(null)
  const ignoreFkShortcutUntilRef = useRef(0)
  const restoreGridFocusAfterFkCloseRef = useRef(false)

  // ---------------------------------------------------------------------------
  // BLOB viewer state — opened by double-clicking a binary cell. Mirrors the
  // conditional FkLookupDialog render below.
  // ---------------------------------------------------------------------------
  const [blobDialogOpen, setBlobDialogOpen] = useState(false)
  const [blobContext, setBlobContext] = useState<{
    columnKey: string
    rowData: Record<string, unknown>
    pkPairs: [string, unknown][] | null
  } | null>(null)

  // ---------------------------------------------------------------------------
  // Column descriptors: TableDataColumnMeta[] → GridColumnDescriptor[]
  // ---------------------------------------------------------------------------
  const descriptorColumns = useMemo(
    () =>
      buildColumnDescriptors(columns, isReadOnly, hasPk, foreignKeys).map((column) => ({
        ...column,
        width: columnWidths[column.key],
      })),
    [columns, isReadOnly, hasPk, foreignKeys, columnWidths]
  )

  // ---------------------------------------------------------------------------
  // Row data: transform array-of-arrays → array-of-objects for BaseGridView.
  // Overlays editState current values, __editingRowKey, and __tempId.
  // ---------------------------------------------------------------------------
  const rowData: TableDataRow[] = useMemo(() => {
    return rows.map((row, rowIdx) => {
      const obj: TableDataRow = { __rowIndex: rowIdx }
      columns.forEach((col, i) => {
        obj[col.name] = row[i] ?? null
      })
      // Carry forward __tempId for new rows
      if (editState?.isNewRow && editState.tempId && rowIdx === rows.length - 1) {
        obj.__tempId = editState.tempId
      }
      if (editState) {
        const rowKey = getRowKey(obj, pkColumns)
        if (isSameRowKey(rowKey, editState.rowKey)) {
          obj.__editingRowKey = editState.rowKey
          for (const [colName, value] of Object.entries(editState.currentValues)) {
            obj[colName] = value
          }
        }
      }
      return obj
    })
  }, [rows, columns, pkColumns, editState])

  // Keep a ref to the latest rowData for post-async lookups
  const rowDataRef = useRef<TableDataRow[]>(rowData)
  useEffect(() => {
    rowDataRef.current = rowData
  }, [rowData])

  useEffect(() => {
    if (!columnJumpRequest) return
    const idx = descriptorColumns.findIndex((column) => column.key === columnJumpRequest.columnKey)
    if (idx < 0) return

    if (tabState?.selectedCell && selectedRowKey) {
      const rowIdx = findRowIndexByKey(rowData, selectedRowKey, pkColumns)
      const row = rowData[rowIdx]
      if (row && tabState.selectedCell.columnKey !== columnJumpRequest.columnKey) {
        setSelectedCell(tabId, {
          columnKey: columnJumpRequest.columnKey,
          value: row[columnJumpRequest.columnKey],
        })
      } else {
        gridRef.current?.scrollToCell({ idx }, 'horizontal')
      }
    } else {
      gridRef.current?.scrollToCell({ idx }, 'horizontal')
    }
    consumeColumnJump(tabId)
  }, [
    columnJumpRequest,
    consumeColumnJump,
    descriptorColumns,
    pkColumns,
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
      if (pkColumns.length > 0) {
        return JSON.stringify(pkColumns.map((c) => row[c]))
      }
      return String(row.__rowIndex)
    },
    [pkColumns]
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
      const classes: string[] = []
      const rowKey = getRowKey(row, pkColumns)

      if (editState) {
        const isEditing = isSameRowKey(rowKey, editState.rowKey)
        if (isEditing && editState.isNewRow) {
          classes.push('grid-editing-row', 'grid-new-row')
        } else if (isEditing) {
          classes.push('grid-editing-row')
        }
      }

      if (selectedRowKey && isSameRowKey(rowKey, selectedRowKey)) {
        classes.push('grid-row-precision-selected')
      }

      return classes.length > 0 ? classes.join(' ') : undefined
    },
    [editState, pkColumns, selectedRowKey]
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

      const rowKey = getRowKey(rowData, pkColumns)
      if (!isSameRowKey(rowKey, currentEditState.rowKey)) return false

      return currentEditState.modifiedColumns.has(columnKey)
    },
    [tabId, pkColumns]
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
  // computeWidth builds a lightweight single-column proxy array (N×1) instead
  // of the full N×M row-to-array transformation, matching the optimisation
  // applied to ResultGridView. getAutoSizedColumnWidth then samples only the
  // first AUTO_SIZE_SAMPLE_LIMIT rows, keeping the total work O(100) per col.
  // ---------------------------------------------------------------------------
  const autoSizeConfig: AutoSizeConfig | undefined = useMemo(() => {
    // Precompute: name → column meta lookup
    const colMetaByName = new Map<string, TableDataColumnMeta>()
    const colIndexByName = new Map<string, number>()
    for (let i = 0; i < columns.length; i++) {
      colMetaByName.set(columns[i].name, columns[i])
      colIndexByName.set(columns[i].name, i)
    }

    return {
      enabled: true,
      computeWidth: (col: GridColumnDescriptor) => {
        const meta = colMetaByName.get(col.key)
        const columnIndex = colIndexByName.get(col.key)
        if (!meta) return 150
        if (columnIndex == null) return 150
        // Build a lightweight proxy array that extracts only the target column
        // from the committed table rows, so in-progress edit-state overlays do
        // not cause the visible column to resize under the floating editor.
        const columnRows: unknown[][] = new Array(rows.length)
        for (let i = 0; i < rows.length; i++) {
          columnRows[i] = [rows[i][columnIndex]]
        }
        // FK icon (Link, 10px) or read-only lock icon (Lock, 10px) + 4px gap.
        // BLOB columns stay editable through the shared viewer, so they show no lock.
        const showLock = !col.editable && col.blobViewerEditable !== true
        const headerIconWidthPx = col.foreignKey || showLock ? 14 : 0
        return getAutoSizedColumnWidth(
          meta,
          0, // column is at index 0 in our single-column proxy array
          columnRows,
          col.key,
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

      const dir = direction.toLowerCase() as 'asc' | 'desc'
      requestNavigationAction(tabId, () => {
        sortByColumn(tabId, column, dir)
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
      const targetColIdx = descriptorColumns.findIndex((c) => c.key === columnKey)
      if (targetColIdx < 0) return null
      const descriptor = descriptorColumns[targetColIdx]
      const editable = descriptor.editable === true
      return { editable, targetColIdx }
    },
    [descriptorColumns]
  )

  /**
   * Validate temporal columns on the current edit state and commit the editing
   * row if switching rows. Returns `true` if the guard passed (or no commit
   * was needed), `false` if it failed (validation error or save error).
   */
  const validateAndCommitCurrentEdit = useCallback(
    async (
      targetRowKey: Record<string, unknown>,
      fallbackRowIdx: number,
      targetColIdx: number,
      options: { enableEditorOnRestore: boolean }
    ): Promise<{ passed: boolean; result?: CellClickGuardResult }> => {
      const currentState = useTableDataStore.getState().tabs[tabId]
      const currentEditState = currentState?.editState ?? null
      const currentEditRowKey = currentEditState?.rowKey ?? null
      const restoreRowIdx = (() => {
        if (!currentState?.editState) return fallbackRowIdx
        if ('__tempId' in currentState.editState.rowKey) {
          return Math.max(0, currentState.rows.length - 1)
        }

        const matchedRowIdx = findStoreRowIndexByKey(
          currentState.rows,
          currentState.columns,
          currentState.editState.rowKey
        )

        return matchedRowIdx >= 0 ? matchedRowIdx : fallbackRowIdx
      })()
      const buildRestoreFocusResult = (): CellClickGuardResult => ({
        proceed: false,
        targetRowIdx: restoreRowIdx,
        targetColIdx,
        enableEditor: options.enableEditorOnRestore,
        restoreFocus: true,
      })

      if (!isSameRowKey(targetRowKey, currentEditRowKey) && currentEditRowKey !== null) {
        // Validate temporal columns
        const validationError = getTemporalValidationResult(currentEditState, columns)
        if (validationError) {
          showError('Invalid date value', `${validationError.columnName}: ${validationError.error}`)
          // Snap selection back to the editing row
          if (currentEditState) {
            setSelectedRow(tabId, currentEditState.rowKey)
          }
          return {
            passed: false,
            result: buildRestoreFocusResult(),
          }
        }

        const hadPendingChanges = (currentEditState?.modifiedColumns.size ?? 0) > 0

        // Commit the old row first (async save)
        await commitEditingRowIfNeeded(tabId, targetRowKey)

        // Check if save failed
        const updatedState = useTableDataStore.getState().tabs[tabId]
        if (updatedState?.saveError) {
          showError('Save failed', updatedState.saveError)
          // Snap selection back to the editing row
          if (updatedState.editState) {
            setSelectedRow(tabId, updatedState.editState.rowKey)
          }
          return {
            passed: false,
            result: buildRestoreFocusResult(),
          }
        }

        if (hadPendingChanges) {
          showSuccess('Row saved', 'Changes saved successfully.')
        }
      }

      return { passed: true }
    },
    [tabId, columns, commitEditingRowIfNeeded, setSelectedRow, showError, showSuccess]
  )

  /** Find the current row index for a given row key in the latest rowData snapshot. */
  const findCurrentRowIndex = useCallback(
    (targetRowKey: Record<string, unknown>): number => {
      return findRowIndexByKey(rowDataRef.current, targetRowKey, pkColumns)
    },
    [pkColumns]
  )

  const handleCellClickGuard = useCallback(
    async (args: CellClickGuardArgs): Promise<CellClickGuardResult> => {
      if (!args.source || args.source === 'grid-pointer') {
        clearColumnHighlight(tabId)
      }
      const row = args.rowData
      const targetRowKey = getRowKey(row, pkColumns)
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
      const { editable, targetColIdx } = target

      // Validate and commit current edit if switching rows (async guard)
      const guardResult = await validateAndCommitCurrentEdit(
        targetRowKey,
        args.rowIdx,
        targetColIdx,
        { enableEditorOnRestore: !isKeyboardNavigation }
      )
      if (!guardResult.passed) {
        return guardResult.result!
      }

      // Guard passed — NOW update selectedRowKey and selectedCell
      setSelectedRow(tabId, targetRowKey)
      setSelectedCell(tabId, { columnKey: args.columnKey, value: args.rowData[args.columnKey] })

      if (!editable) {
        const rowIdx = findCurrentRowIndex(targetRowKey)
        return {
          proceed: true,
          targetRowIdx: rowIdx >= 0 ? rowIdx : args.rowIdx,
          targetColIdx,
          enableEditor: false,
        }
      }

      // Start tracking the new row for editable cells, including keyboard typing activation.
      ensureRowEditingStarted(targetRowKey, row)

      // Find current rowIdx for captured row key and keep pointer single-click selection-only.
      const finalRowIdx = findCurrentRowIndex(targetRowKey)

      if (finalRowIdx >= 0) {
        return {
          proceed: true,
          targetRowIdx: finalRowIdx,
          targetColIdx,
          enableEditor: isKeyboardTyping,
        }
      }

      return {
        proceed: false,
        targetRowIdx: args.rowIdx,
        targetColIdx,
        enableEditor: false,
      }
    },
    [
      pkColumns,
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
  const handleRowsChange = useCallback(
    (newRows: TableDataRow[], data: { indexes: number[]; column?: { key: string } }) => {
      const changedColumnKey = data.column?.key

      if (changedColumnKey) {
        for (const idx of data.indexes) {
          const row = newRows[idx]
          if (!row) continue

          const currentEditState = useTableDataStore.getState().tabs[tabId]?.editState
          if (!currentEditState) continue

          const rowKey =
            (row.__editingRowKey as Record<string, unknown> | undefined) ??
            getRowKey(row, pkColumns)
          if (!isSameRowKey(rowKey, currentEditState.rowKey)) continue

          const nextValue = row[changedColumnKey]
          useTableDataStore
            .getState()
            .syncCellValue(
              tabId,
              { ...row, __editingRowKey: rowKey },
              changedColumnKey,
              nextValue,
              rowKey
            )
        }
      }

      for (const idx of data.indexes) {
        const row = newRows[idx]
        if (!row) continue
        const rowKey = getRowKey(row, pkColumns)
        clearEditStateIfUnmodified(tabId, rowKey)
      }
    },
    [pkColumns, tabId, clearEditStateIfUnmodified]
  )

  const handleCellClipboardEdit = useCallback(
    async (args: CellClipboardEditArgs) => {
      const target = resolveTargetColumn(args.columnKey)
      if (!target?.editable) return

      const targetRowKey = getRowKey(args.rowData, pkColumns)

      const guardResult = await validateAndCommitCurrentEdit(
        targetRowKey,
        args.rowIdx,
        target.targetColIdx,
        { enableEditorOnRestore: true }
      )
      if (!guardResult.passed) return

      setSelectedRow(tabId, targetRowKey)

      ensureRowEditingStarted(targetRowKey, args.rowData)

      const nextValue = args.action === 'cut' ? null : (args.text ?? null)
      storeUpdateCellValue(tabId, args.columnKey, nextValue)
      useTableDataStore
        .getState()
        .syncCellValue(tabId, args.rowData, args.columnKey, nextValue, targetRowKey)
    },
    [
      resolveTargetColumn,
      pkColumns,
      validateAndCommitCurrentEdit,
      setSelectedRow,
      tabId,
      ensureRowEditingStarted,
      storeUpdateCellValue,
    ]
  )

  const handleCellValueChange = useCallback(
    (rowIdx: number, columnKey: string, nextValue: unknown) => {
      const row = rowDataRef.current[rowIdx]
      if (!row) return
      storeUpdateCellValue(tabId, columnKey, nextValue)
    },
    [storeUpdateCellValue, tabId]
  )

  // ---------------------------------------------------------------------------
  // FK Lookup callback — runs the unsaved-edit guard, then stores the lookup
  // request in local state. Phase 6B renders FkLookupDialog with this context.
  // ---------------------------------------------------------------------------
  const handleFkLookup = useCallback(
    async (args: FkLookupArgs) => {
      if (args.source === 'grid-pointer' && Date.now() < ignoreFkShortcutUntilRef.current) {
        return
      }

      const targetRowKey = getRowKey(args.rowData, pkColumns)

      // Find the row index in the latest rowData snapshot
      const fallbackRowIdx = findRowIndexByKey(rowDataRef.current, targetRowKey, pkColumns)

      // Find the column index in descriptorColumns
      const targetColIdx = descriptorColumns.findIndex((c) => c.key === args.columnKey)

      // Run the unsaved-edit guard (same pattern as cell click guard)
      const guardResult = await validateAndCommitCurrentEdit(
        targetRowKey,
        fallbackRowIdx >= 0 ? fallbackRowIdx : 0,
        targetColIdx >= 0 ? targetColIdx : 0,
        { enableEditorOnRestore: args.source !== 'keyboard' }
      )

      if (guardResult.passed) {
        setSelectedRow(tabId, targetRowKey)
        setFkLookupContext({
          columnKey: args.columnKey,
          currentValue: args.currentValue,
          foreignKey: args.foreignKey,
          rowData: args.rowData,
        })
        setFkLookupOpen(true)
      }
    },
    [pkColumns, descriptorColumns, validateAndCommitCurrentEdit, setSelectedRow, tabId]
  )

  const handleFkCellAction = useCallback(
    async (args: CellClickGuardArgs) => {
      const fk = descriptorColumns.find((column) => column.key === args.columnKey)?.foreignKey
      if (!fk) return
      await handleFkLookup({
        columnKey: args.columnKey,
        currentValue: args.rowData[args.columnKey],
        foreignKey: fk,
        rowData: args.rowData,
        source: args.source === 'keyboard' ? 'keyboard' : 'grid-pointer',
      })
    },
    [descriptorColumns, handleFkLookup]
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
      const canEdit = !isReadOnly && hasPk && pkColumns.length > 0
      if (!canEdit) return
      const converted = buildEnvelopedPkPairs(pkColumns, columns, row)
      if (!converted.ok) {
        showError('Could not open BLOB viewer', converted.error)
        return
      }

      setBlobContext({ columnKey, rowData: row, pkPairs: converted.pairs })
      setBlobDialogOpen(true)
    },
    [descriptorColumns, isReadOnly, hasPk, pkColumns, columns, showError]
  )

  const closeBlobDialog = useCallback(() => {
    setBlobDialogOpen(false)
    setBlobContext(null)
  }, [])

  const blobLoader = useCallback(() => {
    if (!blobContext?.pkPairs || !tabState) {
      throw new Error('Cannot load BLOB without a resolvable primary key')
    }
    return fetchBlobValue(
      tabState.connectionId,
      tabState.database,
      tabState.table,
      blobContext.columnKey,
      blobContext.pkPairs
    )
  }, [blobContext, tabState])

  const handleBlobApply = useCallback(
    (envelope: BlobEnvelope) => {
      if (!blobContext) return
      stageBlobEnvelope(tabId, blobContext.rowData, blobContext.columnKey, envelope)
    },
    [blobContext, stageBlobEnvelope, tabId]
  )

  const editableColumnKeys = useMemo(() => {
    return new Set(
      descriptorColumns.filter((column) => column.editable).map((column) => column.key)
    )
  }, [descriptorColumns])

  const selectedCellPosition = useMemo(() => {
    const selected = tabState?.selectedCell
    if (!selected) return null
    const rowIdx = selectedRowKey ? findRowIndexByKey(rowData, selectedRowKey, pkColumns) : -1
    const idx = descriptorColumns.findIndex((column) => column.key === selected.columnKey)
    return rowIdx >= 0 && idx >= 0 ? { rowIdx, idx } : null
  }, [descriptorColumns, pkColumns, rowData, selectedRowKey, tabState?.selectedCell])

  useLayoutEffect(() => {
    if (fkLookupOpen || !restoreGridFocusAfterFkCloseRef.current || !selectedCellPosition) {
      return
    }

    restoreGridFocusAfterFkCloseRef.current = false
    gridRef.current?.selectCell(selectedCellPosition, {
      shouldFocusCell: true,
      enableEditor: false,
    })
  }, [fkLookupOpen, selectedCellPosition])

  // ---------------------------------------------------------------------------
  // FK Apply callback — applies the selected FK value to the editing cell.
  // ---------------------------------------------------------------------------
  const handleFkApply = useCallback(
    (selectedValue: unknown) => {
      if (!fkLookupContext) return
      const { columnKey, rowData: fkRowData } = fkLookupContext

      // Extract row key using the existing getRowKey helper + pkColumns
      const rowKey = getRowKey(fkRowData, pkColumns)

      // If the selected value is the same as the current cell value AND
      // there's no existing edit with modifications on this row, skip editing
      const currentCellValue = fkLookupContext.currentValue
      const currentEditState = useTableDataStore.getState().tabs[tabId]?.editState
      const isAlreadyEditing = currentEditState && isSameRowKey(currentEditState.rowKey, rowKey)

      if (
        selectedValue === currentCellValue &&
        (!isAlreadyEditing || currentEditState.modifiedColumns.size === 0)
      ) {
        setSelectedRow(tabId, rowKey)
        setFkLookupOpen(false)
        return
      }

      // Check if this row is already being edited; if not, start editing
      if (!currentEditState || !isSameRowKey(currentEditState.rowKey, rowKey)) {
        ensureRowEditingStarted(rowKey, fkRowData)
      }

      // Update the FK cell with the selected value
      storeUpdateCellValue(tabId, columnKey, selectedValue)
      useTableDataStore.getState().syncCellValue(tabId, fkRowData, columnKey, selectedValue, rowKey)

      // Select the edited row so toolbar actions target it correctly
      setSelectedRow(tabId, rowKey)

      // Close the dialog
      setFkLookupOpen(false)
    },
    [
      fkLookupContext,
      tabId,
      pkColumns,
      ensureRowEditingStarted,
      storeUpdateCellValue,
      setSelectedRow,
    ]
  )

  // ---------------------------------------------------------------------------
  // Render: wrap BaseGridView with EditorCallbacksContext and FkLookupProvider
  // ---------------------------------------------------------------------------
  return (
    <EditorCallbacksContext.Provider value={editorCallbacksCtx}>
      <FkLookupProvider onFkLookup={handleFkLookup}>
        <CanvasBaseGridView
          ref={gridRef}
          rows={rowData}
          columns={descriptorColumns}
          editState={sharedEditState}
          sortColumn={sort?.column ?? null}
          sortDirection={sort ? (sort.direction.toUpperCase() as 'ASC' | 'DESC') : null}
          onSortChange={handleSortChange}
          onCellClickGuard={handleCellClickGuard}
          onCellClipboardEdit={handleCellClipboardEdit}
          onRowsChange={handleRowsChange}
          onCellValueChange={handleCellValueChange}
          rowKeyGetter={rowKeyGetter}
          getRowClass={getRowClass}
          isModifiedCell={isModifiedCell}
          autoSizeConfig={autoSizeConfig}
          isEditMode={!isReadOnly && hasPk}
          editableColumnKeys={editableColumnKeys}
          runCellClickGuardOnKeyboardSelection={!isReadOnly && hasPk}
          selectedCellPosition={selectedCellPosition}
          highlightColumnKey={highlightedColumnKey ?? undefined}
          onCellSelectionChange={(args) => {
            if (!args.source || args.source === 'grid-pointer') {
              clearColumnHighlight(tabId)
            }
          }}
          onSelectedCellChange={(pos) => {
            const column = descriptorColumns[pos.idx]
            const row = rowData[pos.rowIdx]
            if (column && row) {
              setSelectedRow(tabId, getRowKey(row, pkColumns))
              setSelectedCell(tabId, { columnKey: column.key, value: row[column.key] })
            }
          }}
          onColumnResize={handleColumnResize}
          onScrollCellChange={handleScrollCellChange}
          initialScrollCell={{
            scrollRow: tabState?.scrollRow ?? 0,
            scrollCol: tabState?.scrollCol ?? 0,
          }}
          scrollToRowIndex={editState?.isNewRow ? rows.length - 1 : null}
          onFkCellAction={handleFkCellAction}
          onCellDoubleClick={handleCellDoubleClick}
          rowMarkers="checkbox"
          onRowMarkersChange={handleRowMarkersChange}
          resetSelectionKey={resetSelectionKey}
          testId="table-data-grid"
          isActive={isActive}
        />
        {fkLookupOpen && fkLookupContext && (
          <FkLookupDialog
            isOpen={fkLookupOpen}
            onClose={() => {
              ignoreFkShortcutUntilRef.current = Date.now() + 250
              restoreGridFocusAfterFkCloseRef.current = true
              setFkLookupOpen(false)
            }}
            onApply={handleFkApply}
            connectionId={tabState.connectionId}
            database={fkLookupContext.foreignKey.referencedDatabase || tabState.database}
            sourceTable={tabState.table}
            sourceColumn={fkLookupContext.columnKey}
            currentValue={fkLookupContext.currentValue}
            referencedTable={fkLookupContext.foreignKey.referencedTable}
            referencedColumn={fkLookupContext.foreignKey.referencedColumn}
            isReadOnly={isReadOnly || !hasPk}
          />
        )}
        {blobDialogOpen && blobContext && (
          <BlobViewerDialog
            isOpen={blobDialogOpen}
            onClose={closeBlobDialog}
            mode="edit"
            columnLabel={blobContext.columnKey}
            loader={blobLoader}
            onApply={handleBlobApply}
          />
        )}
      </FkLookupProvider>
    </EditorCallbacksContext.Provider>
  )
}
