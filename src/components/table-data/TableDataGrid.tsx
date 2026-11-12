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
import { buildEnvelopedPrimaryKeyPairs } from '../../lib/blob-utils'
import type { BlobEnvelope } from '../../types/schema'
import {
  useTableDataStore,
  isSameRowKey,
  findRowIndexByKey as findStoreRowIndexByKey,
  getRowKeyFromData,
} from '../../stores/table-data-store'
import { useToastStore } from '../../stores/toast-store'
import { getTemporalValidationResult } from '../../lib/table-data-save-utils'
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
import type { TableDataColumnMeta, ForeignKeyColumnInfo } from '../../types/schema'
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

  const primaryKeyColumns = useMemo(() => primaryKey?.keyColumns ?? [], [primaryKey?.keyColumns])
  const hasPrimaryKey = primaryKey !== null

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
      const draftRowIndex = rows.length - 1
      autoSelectedDraftTempIdRef.current = editState.tempId ?? null
      requestAnimationFrame(() => {
        gridRef.current?.selectCell({ rowIdx: draftRowIndex, idx: 0 }, { shouldFocusCell: true })
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
  const editorCallbacksContext: EditorCallbacksContextType = useMemo(
    () => ({
      tabId: tabId,
      updateCellValue: storeUpdateCellValue,

      syncCellValue: () => {},
    }),
    [tabId, storeUpdateCellValue]
  )

  // ---------------------------------------------------------------------------
  // FK Lookup state — Phase 6B: opens the FkLookupDialog with context.
  // ---------------------------------------------------------------------------
  const [foreignKeyLookupOpen, setForeignKeyLookupOpen] = useState(false)
  const [foreignKeyLookupContext, setForeignKeyLookupContext] = useState<{
    columnKey: string
    currentValue: unknown
    foreignKey: ForeignKeyColumnInfo
    rowData: Record<string, unknown>
  } | null>(null)
  const ignoreForeignKeyShortcutUntilRef = useRef(0)
  const restoreGridFocusAfterForeignKeyCloseRef = useRef(false)

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
    return rows.map((row, rowIndex) => {
      const object: TableDataRow = { __rowIndex: rowIndex }
      columns.forEach((column, columnIndex) => {
        object[column.name] = row[columnIndex] ?? null
      })
      // Carry forward __tempId for new rows
      if (editState?.isNewRow && editState.tempId && rowIndex === rows.length - 1) {
        object.__tempId = editState.tempId
      }
      if (editState) {
        const rowKey = getRowKey(object, primaryKeyColumns)
        if (isSameRowKey(rowKey, editState.rowKey)) {
          object.__editingRowKey = editState.rowKey
          for (const [columnName, value] of Object.entries(editState.currentValues)) {
            object[columnName] = value
          }
        }
      }
      return object
    })
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

    if (tabState?.selectedCell && selectedRowKey) {
      const rowIndex = findRowIndexByKey(rowData, selectedRowKey, primaryKeyColumns)
      const row = rowData[rowIndex]
      if (row && tabState.selectedCell.columnKey !== columnJumpRequest.columnKey) {
        setSelectedCell(tabId, {
          columnKey: columnJumpRequest.columnKey,
          value: row[columnJumpRequest.columnKey],
        })
      } else {
        gridRef.current?.scrollToCell({ idx: index }, 'horizontal')
      }
    } else {
      gridRef.current?.scrollToCell({ idx: index }, 'horizontal')
    }
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
      const classes: string[] = []
      const rowKey = getRowKey(row, primaryKeyColumns)

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
  const validateAndCommitCurrentEdit = useCallback(
    async (
      targetRowKey: Record<string, unknown>,
      fallbackRowIndex: number,
      targetColumnIndex: number,
      options: { enableEditorOnRestore: boolean }
    ): Promise<{ passed: boolean; result?: CellClickGuardResult }> => {
      const currentState = useTableDataStore.getState().tabs[tabId]
      const currentEditState = currentState?.editState ?? null
      const currentEditRowKey = currentEditState?.rowKey ?? null
      const restoreRowIndex = (() => {
        if (!currentState?.editState) return fallbackRowIndex
        if ('__tempId' in currentState.editState.rowKey) {
          return Math.max(0, currentState.rows.length - 1)
        }

        const matchedRowIndex = findStoreRowIndexByKey(
          currentState.rows,
          currentState.columns,
          currentState.editState.rowKey
        )

        return matchedRowIndex >= 0 ? matchedRowIndex : fallbackRowIndex
      })()
      const buildRestoreFocusResult = (): CellClickGuardResult => ({
        proceed: false,
        targetRowIdx: restoreRowIndex,
        targetColIdx: targetColumnIndex,
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
      return findRowIndexByKey(rowDataRef.current, targetRowKey, primaryKeyColumns)
    },
    [primaryKeyColumns]
  )

  const handleCellClickGuard = useCallback(
    async (args: CellClickGuardArgs): Promise<CellClickGuardResult> => {
      if (!args.source || args.source === 'grid-pointer') {
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
  const handleRowsChange = useCallback(
    (newRows: TableDataRow[], data: { indexes: number[]; column?: { key: string } }) => {
      const changedColumnKey = data.column?.key

      if (changedColumnKey) {
        for (const index of data.indexes) {
          const row = newRows[index]
          if (!row) continue

          const currentEditState = useTableDataStore.getState().tabs[tabId]?.editState
          if (!currentEditState) continue

          const rowKey =
            (row.__editingRowKey as Record<string, unknown> | undefined) ??
            getRowKey(row, primaryKeyColumns)
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

      for (const index of data.indexes) {
        const row = newRows[index]
        if (!row) continue
        const rowKey = getRowKey(row, primaryKeyColumns)
        clearEditStateIfUnmodified(tabId, rowKey)
      }
    },
    [primaryKeyColumns, tabId, clearEditStateIfUnmodified]
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
        setForeignKeyLookupContext({
          columnKey: args.columnKey,
          currentValue: args.currentValue,
          foreignKey: args.foreignKey,
          rowData: args.rowData,
        })
        setForeignKeyLookupOpen(true)
      }
    },
    [primaryKeyColumns, descriptorColumns, validateAndCommitCurrentEdit, setSelectedRow, tabId]
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
      const converted = buildEnvelopedPrimaryKeyPairs(primaryKeyColumns, columns, row)
      if (!converted.ok) {
        showError('Could not open BLOB viewer', converted.error)
        return
      }

      setBlobContext({ columnKey: columnKey, rowData: row, pkPairs: converted.pairs })
      setBlobDialogOpen(true)
    },
    [descriptorColumns, isReadOnly, hasPrimaryKey, primaryKeyColumns, columns, showError]
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
    const rowIndex = selectedRowKey
      ? findRowIndexByKey(rowData, selectedRowKey, primaryKeyColumns)
      : -1
    const index = descriptorColumns.findIndex((column) => column.key === selected.columnKey)
    return rowIndex >= 0 && index >= 0 ? { rowIdx: rowIndex, idx: index } : null
  }, [descriptorColumns, primaryKeyColumns, rowData, selectedRowKey, tabState?.selectedCell])

  useLayoutEffect(() => {
    if (
      foreignKeyLookupOpen ||
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
  }, [foreignKeyLookupOpen, selectedCellPosition])

  // ---------------------------------------------------------------------------
  // FK Apply callback — applies the selected FK value to the editing cell.
  // ---------------------------------------------------------------------------
  const handleForeignKeyApply = useCallback(
    (selectedValue: unknown) => {
      if (!foreignKeyLookupContext) return
      const { columnKey, rowData: foreignKeyRowData } = foreignKeyLookupContext

      // Extract row key using the existing getRowKey helper + pkColumns
      const rowKey = getRowKey(foreignKeyRowData, primaryKeyColumns)

      // If the selected value is the same as the current cell value AND
      // there's no existing edit with modifications on this row, skip editing
      const currentCellValue = foreignKeyLookupContext.currentValue
      const currentEditState = useTableDataStore.getState().tabs[tabId]?.editState
      const isAlreadyEditing = currentEditState && isSameRowKey(currentEditState.rowKey, rowKey)

      if (
        selectedValue === currentCellValue &&
        (!isAlreadyEditing || currentEditState.modifiedColumns.size === 0)
      ) {
        setSelectedRow(tabId, rowKey)
        setForeignKeyLookupOpen(false)
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
      setForeignKeyLookupOpen(false)
    },
    [
      foreignKeyLookupContext,
      tabId,
      primaryKeyColumns,
      ensureRowEditingStarted,
      storeUpdateCellValue,
      setSelectedRow,
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
          isEditMode={!isReadOnly && hasPrimaryKey}
          editableColumnKeys={editableColumnKeys}
          runCellClickGuardOnKeyboardSelection={!isReadOnly && hasPrimaryKey}
          selectedCellPosition={selectedCellPosition}
          highlightColumnKey={highlightedColumnKey ?? undefined}
          onCellSelectionChange={(args) => {
            if (!args.source || args.source === 'grid-pointer') {
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
          initialScrollCell={{
            scrollRow: tabState?.scrollRow ?? 0,
            scrollCol: tabState?.scrollCol ?? 0,
          }}
          scrollToRowIndex={editState?.isNewRow ? rows.length - 1 : null}
          onFkCellAction={handleForeignKeyCellAction}
          onCellDoubleClick={handleCellDoubleClick}
          rowMarkers="checkbox"
          onRowMarkersChange={handleRowMarkersChange}
          resetSelectionKey={resetSelectionKey}
          testId="table-data-grid"
          isActive={isActive}
        />
        {foreignKeyLookupOpen && foreignKeyLookupContext && (
          <FkLookupDialog
            isOpen={foreignKeyLookupOpen}
            onClose={() => {
              ignoreForeignKeyShortcutUntilRef.current =
                Date.now() + FOREIGN_KEY_SHORTCUT_COOLDOWN_MS
              restoreGridFocusAfterForeignKeyCloseRef.current = true
              setForeignKeyLookupOpen(false)
            }}
            onApply={handleForeignKeyApply}
            connectionId={tabState.connectionId}
            database={foreignKeyLookupContext.foreignKey.referencedDatabase || tabState.database}
            sourceTable={tabState.table}
            sourceColumn={foreignKeyLookupContext.columnKey}
            currentValue={foreignKeyLookupContext.currentValue}
            referencedTable={foreignKeyLookupContext.foreignKey.referencedTable}
            referencedColumn={foreignKeyLookupContext.foreignKey.referencedColumn}
            isReadOnly={isReadOnly || !hasPrimaryKey}
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
