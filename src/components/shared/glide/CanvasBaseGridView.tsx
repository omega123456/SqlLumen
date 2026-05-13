import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  CompactSelection,
  type CellClickedEventArgs,
  type DrawCellCallback,
  type DrawHeaderCallback,
  type GridCell,
  type GridSelection,
  type EditableGridCell,
  GridCellKind,
  type GridKeyEventArgs,
  type TextCell,
  type Item,
  type Rectangle,
} from '@glideapps/glide-data-grid'
import { getDefaultColumnWidth } from '../../../lib/grid-column-style'
import type {
  BaseGridViewProps,
  GridColumnDescriptor,
  RowEditState,
} from '../../../types/shared-data-view'
import {
  buildBlobCell,
  buildNullCell,
  buildTextCell,
  classifyCellValue,
} from './glide-cell-content'
import { buildGlideColumns } from './glide-column-adapter'
import { drawCustomHeader } from './glide-header-rendering'
import {
  drawFkEllipsis,
  drawHighlightedColumnBackground,
  drawInfoAffordance,
  drawModifiedCellIndicator,
  drawSelectedRowAccent,
} from './glide-drawers'
import { GlideDataGrid } from './GlideDataGrid'
import type { GridColumn, GridHandle, GridSortColumn } from './glide-grid-types'
import { getGlideEditor } from './glide-editors'

import { logFrontend } from '../../../lib/app-log-commands'
type GridRow = Record<string, unknown>
type GlideKeyDownEvent = GridKeyEventArgs
type ScrollCell = { scrollRow: number; scrollCol: number }

interface EditorSessionBaseline {
  rowIndex: number
  columnKey: string
  value: unknown
}

function normalizeEditorValue(value: unknown): unknown {
  return value == null ? null : String(value)
}

export interface CanvasBaseGridViewProps extends BaseGridViewProps {
  rowMarkers?: 'none' | 'checkbox' | 'number' | 'both'
  onRowMarkersChange?: (selectedRows: GridRow[]) => void
  selectedRows?: ReadonlySet<string | number>
  onInfoCellClick?: (row: GridRow, anchorRect: DOMRect) => void
  onSelectedRowChange?: (row: GridRow | null, rowIndex: number | null) => void
  onRowDoubleClicked?: (row: GridRow) => void
}

function toGridColumn(
  column: GridColumnDescriptor,
  rows: GridRow[],
  autoSizeConfig: CanvasBaseGridViewProps['autoSizeConfig']
): GridColumn<GridRow> {
  const computedWidth =
    typeof column.width === 'number'
      ? column.width
      : autoSizeConfig?.enabled === true
        ? autoSizeConfig.computeWidth(column, rows)
        : undefined
  return {
    key: column.key,
    name: column.displayName,
    width:
      computedWidth ??
      (column.editable
        ? getDefaultColumnWidth(column.dataType)
        : getDefaultColumnWidth(column.dataType) + 14),
    resizable: true,
    sortable: true,
    editable: column.editable,
    foreignKey: column.foreignKey,
    isNullable: column.isNullable,
    isBinary: column.isBinary,
    tableColumnMeta: column.tableColumnMeta,
    editorType: column.editorType,
    enumValues: column.enumValues,
  }
}

function isInfoColumn(column: GridColumn<GridRow>): boolean {
  return column.key === 'info'
}

function clampScrollCell(scrollCell: ScrollCell, maxRow: number, maxCol: number): ScrollCell {
  return {
    scrollRow: Math.max(0, Math.min(maxRow, Math.floor(scrollCell.scrollRow))),
    scrollCol: Math.max(0, Math.min(maxCol, Math.floor(scrollCell.scrollCol))),
  }
}

function isSameScrollCell(a: ScrollCell | null, b: ScrollCell): boolean {
  return a?.scrollRow === b.scrollRow && a.scrollCol === b.scrollCol
}

function resolveEditorBaselineValue(
  row: GridRow,
  columnKey: string,
  editState: RowEditState | null
): unknown {
  if (Object.prototype.hasOwnProperty.call(editState?.currentValues ?? {}, columnKey)) {
    return editState?.currentValues[columnKey]
  }

  if (Object.prototype.hasOwnProperty.call(editState?.originalValues ?? {}, columnKey)) {
    return editState?.originalValues[columnKey]
  }

  return row[columnKey]
}

function CanvasBaseGridViewInner(props: CanvasBaseGridViewProps, ref: React.Ref<GridHandle>) {
  const {
    rows,
    columns,
    sortColumn,
    sortDirection,
    onSortChange,
    onColumnResize,
    onCellSelectionChange,
    onCellDoubleClick,
    onRowClick,
    highlightColumnKey,
    selectedRowIndex,
    selectedRows,
    onRowMarkersChange,
    getRowClass,
    isModifiedCell,
    testId,
    rowMarkers = 'none',
    onInfoCellClick,
    onSelectedRowChange,
    onRowDoubleClicked,
    selectedCellPosition,
    onSelectedCellChange,
    isEditMode,
    editableColumnKeys,
    onCellValueChange,
    onRowChanging,
    onCellClipboardEdit,
    onCellClickGuard,
    editState,
    onRowsChange,
    onScrollCellChange,
    initialScrollCell,
    scrollToRowIndex,
    onFkCellAction,
    showInfoColumn = false,
    isActive = true,
    runCellClickGuardOnKeyboardSelection = false,
  } = props
  const gridRef = useRef<GridHandle | null>(null)
  useImperativeHandle(ref, () => gridRef.current as GridHandle, [])
  const [internalSelectedRowIndex, setInternalSelectedRowIndex] = useState<number | null>(null)
  const [gridSelection, setGridSelection] = useState<GridSelection | undefined>(undefined)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const lastInteractedCellRef = useRef<{ rowIdx: number; idx: number } | null>(null)
  const lastAppliedInitialScrollRef = useRef<{ scrollRow: number; scrollCol: number } | null>(null)
  const lastReportedScrollCellRef = useRef<ScrollCell | null>(null)
  const pendingInitialScrollRestoreRef = useRef<ScrollCell | null>(null)
  const suppressScrollPersistenceRef = useRef(false)
  const isEditingCellRef = useRef(false)
  const editorSessionBaselineRef = useRef<EditorSessionBaseline | null>(null)
  const activeSelectedRowIndex = selectedRowIndex ?? internalSelectedRowIndex

  const isRowSelected = useCallback(
    (row: GridRow): boolean => {
      return (
        selectedRows?.has(row.id as string | number) === true ||
        getRowClass?.(row)?.includes('selected') === true
      )
    },
    [getRowClass, selectedRows]
  )

  const isRowEditing = useCallback(
    (row: GridRow): boolean => getRowClass?.(row)?.includes('editing-row') === true,
    [getRowClass]
  )

  const gridColumns = useMemo<GridColumn<GridRow>[]>(() => {
    const dataColumns = columns.map((column) => toGridColumn(column, rows, props.autoSizeConfig))
    if (!showInfoColumn) return dataColumns
    return [
      ...dataColumns,
      { key: 'info', name: 'Info', width: 260, resizable: true, sortable: true },
    ]
  }, [columns, props.autoSizeConfig, rows, showInfoColumn])

  const glideColumns = useMemo(
    () => buildGlideColumns(gridColumns, { hasRowMarker: rowMarkers !== 'none' }),
    [gridColumns, rowMarkers]
  )

  const selectedSelection = useMemo<GridSelection | undefined>(() => {
    let rowSelection = CompactSelection.empty()
    rows.forEach((row, index) => {
      if (isRowSelected(row)) {
        rowSelection = rowSelection.add(index)
      }
    })
    if (activeSelectedRowIndex != null) rowSelection = rowSelection.add(activeSelectedRowIndex)
    return {
      columns: CompactSelection.empty(),
      rows: rowSelection,
      current: selectedCellPosition
        ? {
            cell: [selectedCellPosition.idx, selectedCellPosition.rowIdx],
            range: {
              x: selectedCellPosition.idx,
              y: selectedCellPosition.rowIdx,
              width: 1,
              height: 1,
            },
            rangeStack: [],
          }
        : undefined,
    }
  }, [activeSelectedRowIndex, isRowSelected, rows, selectedCellPosition])

  useEffect(() => {
    setGridSelection(selectedSelection)
  }, [selectedSelection])

  const changeSelectedCell = useCallback(
    async (rowIndex: number, colIndex: number): Promise<boolean> => {
      const fromRow = selectedCellPosition?.rowIdx ?? activeSelectedRowIndex
      if (fromRow != null && fromRow !== rowIndex && onRowChanging) {
        const ok = await onRowChanging(fromRow, rowIndex)
        if (!ok) {
          if (selectedCellPosition)
            gridRef.current?.selectCell(selectedCellPosition, { shouldFocusCell: true })
          return false
        }
      }
      onSelectedCellChange?.({ rowIdx: rowIndex, idx: colIndex })
      return true
    },
    [activeSelectedRowIndex, onRowChanging, onSelectedCellChange, selectedCellPosition]
  )

  const selectRow = useCallback(
    (rowIndex: number | null) => {
      const row = rowIndex == null ? null : (rows[rowIndex] ?? null)
      const nextIndex = row == null ? null : rowIndex
      setInternalSelectedRowIndex(nextIndex)
      onSelectedRowChange?.(row, nextIndex)
    },
    [onSelectedRowChange, rows]
  )

  const sortColumns = useMemo<GridSortColumn[]>(() => {
    return sortColumn && sortDirection ? [{ columnKey: sortColumn, direction: sortDirection }] : []
  }, [sortColumn, sortDirection])

  useLayoutEffect(() => {
    if (!initialScrollCell || rows.length === 0 || gridColumns.length === 0) return
    const normalized = clampScrollCell(initialScrollCell, rows.length - 1, gridColumns.length - 1)
    const lastApplied = lastAppliedInitialScrollRef.current
    if (isSameScrollCell(lastApplied, normalized)) {
      return
    }

    const lastReported = lastReportedScrollCellRef.current
    if (isSameScrollCell(lastReported, normalized)) {
      lastAppliedInitialScrollRef.current = normalized
      pendingInitialScrollRestoreRef.current = null
      suppressScrollPersistenceRef.current = false
      return
    }

    lastAppliedInitialScrollRef.current = normalized
    pendingInitialScrollRestoreRef.current = normalized
    suppressScrollPersistenceRef.current = true

    let releaseSuppressionFrameId = 0
    const restoreFrameId = requestAnimationFrame(() => {
      gridRef.current?.scrollToCell({ rowIdx: normalized.scrollRow, idx: normalized.scrollCol })
      releaseSuppressionFrameId = requestAnimationFrame(() => {
        if (isSameScrollCell(pendingInitialScrollRestoreRef.current, normalized)) {
          pendingInitialScrollRestoreRef.current = null
        }
        suppressScrollPersistenceRef.current = false
      })
    })

    return () => {
      cancelAnimationFrame(restoreFrameId)
      if (releaseSuppressionFrameId !== 0) {
        cancelAnimationFrame(releaseSuppressionFrameId)
      }
      if (isSameScrollCell(pendingInitialScrollRestoreRef.current, normalized)) {
        pendingInitialScrollRestoreRef.current = null
      }
      suppressScrollPersistenceRef.current = false
    }
  }, [gridColumns.length, initialScrollCell, rows.length])

  useEffect(() => {
    if (scrollToRowIndex == null || scrollToRowIndex < 0) return
    requestAnimationFrame(() => {
      gridRef.current?.selectCell({ rowIdx: scrollToRowIndex, idx: 0 }, { shouldFocusCell: true })
    })
  }, [scrollToRowIndex])

  const getCellContent = useCallback(
    ([colIndex, rowIndex]: Item): GridCell => {
      const column = gridColumns[colIndex]
      const row = rows[rowIndex]
      if (!column || !row) return buildTextCell('', classifyCellValue('', ''))
      const rawValue = row[column.key]
      const flags = classifyCellValue(rawValue, column.key, {
        isReadOnly: isEditMode === true && editableColumnKeys?.has(column.key) !== true,
        isModified: isModifiedCell?.(row, column.key) ?? false,
        isFkCell: column.foreignKey != null,
        isBlobColumn: column.isBinary === true,
        isSelectedRow: activeSelectedRowIndex === rowIndex || isRowSelected(row),
        isEditingRow: isRowEditing(row),
        highlightedColumnKey: highlightColumnKey,
      })
      if (flags.isBlob) return buildBlobCell(flags.displayValue, flags.copyValue)
      const editable =
        isEditMode === true &&
        column.editable === true &&
        editableColumnKeys?.has(column.key) === true &&
        column.isBinary !== true &&
        column.editorType !== 'none'
      if (flags.isNull && !editable) return buildNullCell(flags.copyValue)
      if (editable) {
        const baseCell = flags.isNull
          ? buildNullCell(flags.copyValue)
          : buildTextCell(flags.displayValue, flags, flags.copyValue)
        return {
          ...baseCell,
          readonly: false,
          allowOverlay: true,
          data: rawValue == null ? '' : String(rawValue),
          glideEditorData: {
            row,
            columnKey: column.key,
            columnMeta: column.tableColumnMeta,
            isNullable: column.isNullable === true,
            foreignKey: column.foreignKey,
          },
        } as TextCell & { glideEditorData: unknown }
      }
      return buildTextCell(flags.displayValue, flags, flags.copyValue)
    },
    [
      activeSelectedRowIndex,
      editableColumnKeys,
      gridColumns,
      highlightColumnKey,
      isEditMode,
      isModifiedCell,
      isRowEditing,
      isRowSelected,
      rows,
      selectedRows,
    ]
  )

  const handleHeaderClicked = useCallback(
    (columnIndex: number) => {
      const column = gridColumns[columnIndex]
      if (!column || !onSortChange) return
      if (sortColumn !== column.key) {
        onSortChange(column.key, 'ASC')
        return
      }
      if (sortDirection === 'ASC') {
        onSortChange(column.key, 'DESC')
        return
      }
      onSortChange(null, null)
    },
    [gridColumns, onSortChange, sortColumn, sortDirection]
  )

  const handleCellClicked = useCallback(
    (cell: Item, event: CellClickedEventArgs) => {
      const [colIndex, rowIndex] = cell
      const row = rows[rowIndex]
      const column = gridColumns[colIndex]
      if (!row || !column) return
      lastInteractedCellRef.current = { rowIdx: rowIndex, idx: colIndex }

      const isFkAffordanceClick =
        column.foreignKey != null &&
        event.bounds != null &&
        (event.localEventX ?? 0) >= event.bounds.width - 28

      if (isFkAffordanceClick) {
        const runFkLookup = async () => {
          const ok = await changeSelectedCell(rowIndex, colIndex)
          if (ok) {
            selectRow(rowIndex)
            await onFkCellAction?.({
              rowIdx: rowIndex,
              columnKey: column.key,
              rowData: row,
              source: 'grid-pointer',
            })
          }
        }

        void runFkLookup()
        onCellSelectionChange?.({ rowIdx: rowIndex, columnKey: column.key, rowData: row })
        onRowClick?.(row, column.key)
        return
      }

      const run = async () => {
        const guard = onCellClickGuard
          ? await onCellClickGuard({ rowIdx: rowIndex, columnKey: column.key, rowData: row })
          : { proceed: true, targetRowIdx: rowIndex, targetColIdx: colIndex, enableEditor: false }
        if (!guard.proceed) {
          if (guard.restoreFocus) {
            gridRef.current?.selectCell(
              { rowIdx: guard.targetRowIdx, idx: guard.targetColIdx },
              { shouldFocusCell: true, enableEditor: guard.enableEditor }
            )
          }
          return
        }
        const ok = await changeSelectedCell(guard.targetRowIdx, guard.targetColIdx)
        if (ok) {
          selectRow(guard.targetRowIdx)
          const guardedColumn = gridColumns[guard.targetColIdx]
          const guardedRow = rows[guard.targetRowIdx]
          if (guardedColumn && guardedRow) {
            onCellSelectionChange?.({
              rowIdx: guard.targetRowIdx,
              columnKey: guardedColumn.key,
              rowData: guardedRow,
              source: 'grid-pointer',
            })
          }
          if (guard.enableEditor) {
            gridRef.current?.selectCell(
              { rowIdx: guard.targetRowIdx, idx: guard.targetColIdx },
              { shouldFocusCell: true, enableEditor: true }
            )
          }
        }
      }
      void run()
      onRowClick?.(row, column.key)
      if (
        isInfoColumn(column) &&
        typeof row.info === 'string' &&
        row.info.length > 0 &&
        event.bounds
      ) {
        const rect = new DOMRect(
          event.bounds.x,
          event.bounds.y,
          event.bounds.width,
          event.bounds.height
        )
        onInfoCellClick?.(row, rect)
      }
    },
    [
      changeSelectedCell,
      gridColumns,
      onCellClickGuard,
      onCellSelectionChange,
      onFkCellAction,
      onInfoCellClick,
      onRowClick,
      rows,
      selectRow,
    ]
  )

  const handleCellEdited = useCallback(
    (cell: Item, newValue: EditableGridCell) => {
      const [colIndex, rowIndex] = cell
      const column = gridColumns[colIndex]
      if (!column || newValue.kind !== GridCellKind.Text) return
      const next = newValue.data === '' && newValue.copyData === 'NULL' ? null : newValue.data
      const baseline = editorSessionBaselineRef.current
      const isActiveEditorSession =
        baseline?.rowIndex === rowIndex && baseline.columnKey === column.key
      const isNoOpCommit = isActiveEditorSession && Object.is(baseline.value, next)
      if (!isNoOpCommit) {
        onCellValueChange?.(rowIndex, column.key, next)
      }
      const nextRows = isNoOpCommit
        ? rows
        : rows.map((row, index) => (index === rowIndex ? { ...row, [column.key]: next } : row))
      onRowsChange?.(nextRows, { indexes: [rowIndex], column })
    },
    [gridColumns, onCellValueChange, onRowsChange, rows]
  )

  const handlePaste = useCallback(
    (target: Item, values: readonly (readonly string[])[]) => {
      const [colIndex, rowIndex] = target
      const column = gridColumns[colIndex]
      const row = rows[rowIndex]
      const text = values[0]?.[0]
      if (!column || !row || text == null) return false
      void onCellClipboardEdit?.({
        rowIdx: rowIndex,
        rowData: row,
        columnKey: column.key,
        action: 'paste',
        text,
      })
      return true
    },
    [gridColumns, onCellClipboardEdit, rows]
  )

  const clearCellsInRange = useCallback(
    (range: Rectangle) => {
      const nextRows = rows.map((row) => ({ ...row }))
      const changedIndexes = new Set<number>()
      for (let rowIndex = range.y; rowIndex < range.y + range.height; rowIndex += 1) {
        const row = rows[rowIndex]
        if (!row) continue
        for (let colIndex = range.x; colIndex < range.x + range.width; colIndex += 1) {
          const column = gridColumns[colIndex]
          if (!column || isInfoColumn(column)) continue
          const next = column.isNullable === true ? null : ''
          const baseClearedCell = buildTextCell(
            next == null ? '' : String(next),
            classifyCellValue(next, column.key),
            next == null ? 'NULL' : String(next)
          )
          if (baseClearedCell.kind !== GridCellKind.Text) continue
          const clearedCell: TextCell = {
            ...baseClearedCell,
            readonly: false,
            allowOverlay: true,
            data: next == null ? '' : String(next),
          }
          handleCellEdited([colIndex, rowIndex], clearedCell)
          nextRows[rowIndex] = { ...nextRows[rowIndex], [column.key]: next }
          changedIndexes.add(rowIndex)
        }
      }
      if (changedIndexes.size > 0) {
        onRowsChange?.(nextRows, { indexes: [...changedIndexes], column: gridColumns[range.x] })
      }
    },
    [gridColumns, handleCellEdited, onRowsChange, rows]
  )

  const clearSelection = useCallback(
    (selection: GridSelection): boolean => {
      if (selection.current) {
        clearCellsInRange(selection.current.range)
        selection.current.rangeStack.forEach(clearCellsInRange)
      }
      for (const rowIndex of selection.rows) {
        clearCellsInRange({ x: 0, y: rowIndex, width: gridColumns.length, height: 1 })
      }
      for (const colIndex of selection.columns) {
        clearCellsInRange({ x: colIndex, y: 0, width: 1, height: rows.length })
      }
      return false
    },
    [clearCellsInRange, gridColumns.length, rows.length]
  )

  const selectedRanges = useCallback((): Rectangle[] => {
    const selection = gridSelection
    const ranges: Rectangle[] = []
    if (selection?.current) ranges.push(selection.current.range, ...selection.current.rangeStack)
    if (selection) {
      for (const rowIndex of selection.rows)
        ranges.push({ x: 0, y: rowIndex, width: gridColumns.length, height: 1 })
      for (const colIndex of selection.columns)
        ranges.push({ x: colIndex, y: 0, width: 1, height: rows.length })
    }
    return ranges
  }, [gridColumns.length, gridSelection, rows.length])

  const copySelectionToClipboard = useCallback(async (): Promise<void> => {
    const text = selectedRanges()
      .flatMap((range) =>
        Array.from({ length: range.height }, (_, rowOffset) =>
          Array.from({ length: range.width }, (_, colOffset) => {
            const cell = getCellContent([range.x + colOffset, range.y + rowOffset])
            return 'copyData' in cell && typeof cell.copyData === 'string' ? cell.copyData : ''
          }).join('\t')
        )
      )
      .join('\n')
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
    } catch (error) {
      logFrontend('warn', `Failed to write grid selection to clipboard: ${String(error)}`)
    }
  }, [getCellContent, selectedRanges])

  const pasteClipboardAtSelection = useCallback(async (): Promise<void> => {
    const target = gridSelection?.current?.cell
    if (!target) return
    try {
      const text = await navigator.clipboard.readText()
      handlePaste(
        target,
        text.split(/\r?\n/).map((line) => line.split('\t'))
      )
    } catch (error) {
      logFrontend('warn', `Failed to read grid clipboard text: ${String(error)}`)
    }
  }, [handlePaste, gridSelection])

  const cutSelectionToClipboard = useCallback(async (): Promise<void> => {
    await copySelectionToClipboard()
    if (gridSelection) clearSelection(gridSelection)
  }, [clearSelection, copySelectionToClipboard, gridSelection])

  const provideEditor = useCallback(
    (cell: GridCell) => {
      const editorData =
        cell.kind === GridCellKind.Text
          ? (cell as TextCell & { glideEditorData?: { columnKey?: string } }).glideEditorData
          : undefined
      const column = editorData?.columnKey
        ? gridColumns.find((candidate) => candidate.key === editorData.columnKey)
        : undefined
      if (!column || editableColumnKeys?.has(column.key) !== true) return undefined
      return (
        getGlideEditor(
          column as GridColumn<unknown>,
          (column.editorType as 'text' | 'enum' | 'datetime' | 'fk' | 'none' | undefined) ?? 'text'
        ) ?? undefined
      )
    },
    [editableColumnKeys, gridColumns]
  )

  const handleFinishedEditing = useCallback(() => {
    isEditingCellRef.current = false
    editorSessionBaselineRef.current = null
  }, [])

  const cancelActiveEditor = useCallback(() => {
    if (!isEditingCellRef.current) return
    // Glide overlays are absolutely positioned and do not auto-close when commitOnOutsideClick
    // is disabled, so close the active editor before scroll leaves it floating over the wrong cell.
    const canvas = gridRef.current?.element?.querySelector('canvas[data-testid="data-grid-canvas"]')
    canvas?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        keyCode: 27,
        which: 27,
        bubbles: true,
      })
    )
    handleFinishedEditing()
  }, [handleFinishedEditing])

  const handleVisibleRegionChanged = useCallback(
    (range: Rectangle) => {
      cancelActiveEditor()
      const scrollCell = clampScrollCell(
        { scrollRow: range.y, scrollCol: range.x },
        Number.MAX_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER
      )

      if (isSameScrollCell(pendingInitialScrollRestoreRef.current, scrollCell)) {
        pendingInitialScrollRestoreRef.current = null
        return
      }

      if (suppressScrollPersistenceRef.current) {
        return
      }

      pendingInitialScrollRestoreRef.current = null
      lastReportedScrollCellRef.current = scrollCell
      onScrollCellChange?.(scrollCell.scrollRow, scrollCell.scrollCol)
    },
    [cancelActiveEditor, onScrollCellChange]
  )

  const handleCellActivatedForEditing = useCallback(
    (cell: Item) => {
      const [colIndex, rowIndex] = cell
      const column = gridColumns[colIndex]
      const row = rows[rowIndex]
      if (column && row) {
        editorSessionBaselineRef.current = {
          rowIndex,
          columnKey: column.key,
          value: normalizeEditorValue(resolveEditorBaselineValue(row, column.key, editState)),
        }
      } else {
        editorSessionBaselineRef.current = null
      }
      isEditingCellRef.current = true
    },
    [editState?.currentValues, editState?.originalValues, gridColumns, rows]
  )

  const handleCellDoubleClicked = useCallback(
    (cell: Item) => {
      const [colIndex, rowIndex] = cell
      const row = rows[rowIndex]
      const column = gridColumns[colIndex]
      if (row && column) {
        selectRow(rowIndex)
        onCellDoubleClick?.(row, column.key)
        onRowDoubleClicked?.(row)
      }
    },
    [gridColumns, onCellDoubleClick, onRowDoubleClicked, rows, selectRow]
  )

  const triggerFkLookupFromSelection = useCallback(
    (event: { preventDefault: () => void }) => {
      const currentSelection = gridSelection?.current?.cell
      const pos =
        selectedCellPosition ??
        (currentSelection
          ? {
              idx: currentSelection[0],
              rowIdx: currentSelection[1],
            }
          : lastInteractedCellRef.current)
      if (!pos) return false
      const row = rows[pos.rowIdx]
      const column = gridColumns[pos.idx]
      if (!row || !column?.foreignKey) return false
      event.preventDefault()
      void onFkCellAction?.({
        rowIdx: pos.rowIdx,
        columnKey: column.key,
        rowData: row,
        source: 'keyboard',
      })
      return true
    },
    [gridColumns, gridSelection, onFkCellAction, rows, selectedCellPosition]
  )

  const handleKeyDown = useCallback<(event: GlideKeyDownEvent) => void>(
    (event) => {
      if (rows.length === 0) return
      const isShortcut = event.metaKey || event.ctrlKey
      if (isShortcut && event.key.toLowerCase() === 'x') {
        event.preventDefault()
        event.cancel?.()
        void cutSelectionToClipboard()
        return
      }

      const currentCell =
        selectedCellPosition ??
        (gridSelection?.current
          ? {
              idx: gridSelection.current.cell[0],
              rowIdx: gridSelection.current.cell[1],
            }
          : null)

      const moveSelection = (delta: -1 | 1) => {
        const currentRow = currentCell?.rowIdx ?? activeSelectedRowIndex ?? 0
        const nextRow = Math.max(0, Math.min(rows.length - 1, currentRow + delta))
        const nextCol = currentCell?.idx ?? 0

        if (nextRow === currentRow && currentCell) {
          if (activeSelectedRowIndex !== nextRow) {
            selectRow(nextRow)
          }
          gridRef.current?.selectCell(
            { rowIdx: nextRow, idx: nextCol },
            { shouldFocusCell: true, enableEditor: false }
          )
          return
        }

        const nextRowData = rows[nextRow]
        const nextColumn = gridColumns[nextCol]
        if (!nextRowData || !nextColumn) return

        const applySelection = async () => {
          if (runCellClickGuardOnKeyboardSelection && onCellClickGuard) {
            const guard = await onCellClickGuard({
              rowIdx: nextRow,
              columnKey: nextColumn.key,
              rowData: nextRowData,
              source: 'keyboard',
            })

            if (!guard.proceed) {
              if (guard.restoreFocus) {
                gridRef.current?.selectCell(
                  { rowIdx: guard.targetRowIdx, idx: guard.targetColIdx },
                  {
                    shouldFocusCell: true,
                    enableEditor: guard.enableEditor,
                  }
                )
              }
              return
            }

            const ok = await changeSelectedCell(guard.targetRowIdx, guard.targetColIdx)
            if (!ok) return

            selectRow(guard.targetRowIdx)
            gridRef.current?.selectCell(
              { rowIdx: guard.targetRowIdx, idx: guard.targetColIdx },
              {
                shouldFocusCell: true,
                enableEditor: guard.enableEditor,
              }
            )
            onCellSelectionChange?.({
              rowIdx: guard.targetRowIdx,
              columnKey: gridColumns[guard.targetColIdx]?.key ?? nextColumn.key,
              rowData: rows[guard.targetRowIdx] ?? nextRowData,
              source: 'keyboard',
            })
            return
          }

          const ok = await changeSelectedCell(nextRow, nextCol)
          if (!ok) return
          selectRow(nextRow)
          gridRef.current?.selectCell(
            { rowIdx: nextRow, idx: nextCol },
            { shouldFocusCell: true, enableEditor: false }
          )
          onCellSelectionChange?.({
            rowIdx: nextRow,
            columnKey: nextColumn.key,
            rowData: nextRowData,
            source: 'keyboard',
          })
        }

        void applySelection()
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        event.cancel?.()
        moveSelection(1)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        event.cancel?.()
        moveSelection(-1)
        return
      }
      if (event.key === 'Enter' && activeSelectedRowIndex != null) {
        const row = rows[activeSelectedRowIndex]
        if (row) {
          event.preventDefault()
          onRowDoubleClicked?.(row)
        }
      }
      if (isActive && event.key === 'F4') {
        event.cancel?.()
        triggerFkLookupFromSelection(event)
      }
    },
    [
      activeSelectedRowIndex,
      cutSelectionToClipboard,
      gridColumns,
      onRowDoubleClicked,
      onCellClickGuard,
      onCellSelectionChange,
      rows,
      runCellClickGuardOnKeyboardSelection,
      selectedCellPosition,
      selectRow,
      changeSelectedCell,
      gridSelection,
      isActive,
      triggerFkLookupFromSelection,
    ]
  )

  useEffect(() => {
    const isInteractiveElement = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false
      const tag = target.tagName.toLowerCase()
      return (
        ['button', 'input', 'select', 'textarea', 'a'].includes(tag) || target.isContentEditable
      )
    }

    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (!isActive) return
      if (event.defaultPrevented || event.key !== 'F4' || isInteractiveElement(event.target)) {
        return
      }

      triggerFkLookupFromSelection(event)
    }

    document.addEventListener('keydown', handleDocumentKeyDown)
    return () => {
      document.removeEventListener('keydown', handleDocumentKeyDown)
    }
  }, [isActive, triggerFkLookupFromSelection])

  const handleSelectionChange = useCallback(
    (selection: GridSelection) => {
      setGridSelection(selection)
      if (selection.current) {
        lastInteractedCellRef.current = {
          idx: selection.current.cell[0],
          rowIdx: selection.current.cell[1],
        }
      }
      const selected = [...selection.rows]
        .map((rowIndex) => rows[rowIndex])
        .filter((row): row is GridRow => row != null)
      onRowMarkersChange?.(selected)
    },
    [onRowMarkersChange, rows]
  )

  const handleContextMenu = useCallback<React.MouseEventHandler<HTMLDivElement>>((event) => {
    event.preventDefault()
    setContextMenu({ x: event.clientX, y: event.clientY })
  }, [])

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  useEffect(() => {
    if (isActive) return
    closeContextMenu()
    cancelActiveEditor()
  }, [cancelActiveEditor, closeContextMenu, isActive])

  useEffect(() => {
    if (!contextMenu) return
    const onPointerDown = (): void => closeContextMenu()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeContextMenu()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [closeContextMenu, contextMenu])

  const handleColumnResize = useCallback(
    (columnIndex: number, width: number) => {
      const column = gridColumns[columnIndex]
      if (column) onColumnResize?.(column.key, width)
    },
    [gridColumns, onColumnResize]
  )

  const drawCell = useCallback<DrawCellCallback>(
    (args, drawContent) => {
      const row = rows[args.row]
      const column = gridColumns[args.col]
      const isSelected =
        row != null &&
        (activeSelectedRowIndex === args.row ||
          selectedRows?.has(row.id as string | number) === true ||
          isRowSelected(row))
      if (column?.key === highlightColumnKey) {
        drawHighlightedColumnBackground(args.ctx, args.rect, args.theme.bgSearchResult)
      }
      if (isSelected) {
        drawHighlightedColumnBackground(args.ctx, args.rect, args.theme.bgBubbleSelected)
        drawSelectedRowAccent(args.ctx, args.rect, args.theme.accentColor)
      }
      if (row != null && isRowEditing(row)) {
        drawHighlightedColumnBackground(args.ctx, args.rect, args.theme.bgHeaderHovered)
      }
      drawContent()
      if (column && row && isModifiedCell?.(row, column.key)) {
        drawModifiedCellIndicator(args.ctx, args.rect, args.theme.accentColor, false)
      }
      if (column && isInfoColumn(column) && row?.info) {
        drawInfoAffordance(args.ctx, args.rect, args.theme.linkColor)
      }
      if (column?.foreignKey && row) {
        drawFkEllipsis(args.ctx, args.rect, args.theme.linkColor)
      }
    },
    [
      activeSelectedRowIndex,
      gridColumns,
      highlightColumnKey,
      isModifiedCell,
      isRowEditing,
      isRowSelected,
      rows,
      selectedRows,
    ]
  )

  const drawHeader = useCallback<DrawHeaderCallback>(
    (args, drawContent) => {
      const column = gridColumns[args.columnIndex]
      if (!column) {
        drawContent()
        return
      }
      drawCustomHeader(
        args.ctx,
        args,
        {
          sortDirection: sortColumns.find((sort) => sort.columnKey === column.key)?.direction,
          isReadOnly: column.editable !== true,
          hasFkLink: column.foreignKey != null,
          isHighlighted: highlightColumnKey === column.key,
        },
        args.theme
      )
    },
    [gridColumns, highlightColumnKey, sortColumns]
  )

  return (
    <div
      onContextMenu={handleContextMenu}
      style={{ position: 'relative', width: '100%', height: '100%' }}
    >
      <GlideDataGrid
        ref={gridRef}
        columns={glideColumns}
        rows={rows}
        getCellContent={getCellContent}
        onColumnResize={handleColumnResize}
        onHeaderClicked={handleHeaderClicked}
        onCellClicked={handleCellClicked}
        onCellEdited={handleCellEdited}
        onDelete={clearSelection}
        provideEditor={provideEditor}
        onPaste={handlePaste}
        onCellDoubleClicked={handleCellDoubleClicked}
        onCellActivated={handleCellActivatedForEditing}
        onFinishedEditing={handleFinishedEditing}
        onCellContextMenu={handleCellClicked}
        onVisibleRegionChanged={handleVisibleRegionChanged}
        selection={gridSelection}
        onSelectionChange={handleSelectionChange}
        rowMarkers={rowMarkers}
        drawCell={drawCell}
        drawHeader={drawHeader}
        onKeyDown={handleKeyDown}
        aria-label={testId ? `${testId} data grid` : 'Data grid'}
        data-testid={testId}
      />
      {contextMenu ? (
        <ul
          className="ui-context-menu"
          role="menu"
          data-testid={testId ? `${testId}-clipboard-menu` : 'grid-clipboard-menu'}
          style={{ left: contextMenu.x, top: contextMenu.y, position: 'fixed' }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <li role="none">
            <button
              type="button"
              className="ui-context-menu__item"
              role="menuitem"
              onClick={() => {
                void copySelectionToClipboard()
                closeContextMenu()
              }}
            >
              Copy
            </button>
          </li>
          <li role="none">
            <button
              type="button"
              className="ui-context-menu__item"
              role="menuitem"
              onClick={() => {
                void cutSelectionToClipboard()
                closeContextMenu()
              }}
            >
              Cut
            </button>
          </li>
          <li role="none">
            <button
              type="button"
              className="ui-context-menu__item"
              role="menuitem"
              onClick={() => {
                void pasteClipboardAtSelection()
                closeContextMenu()
              }}
            >
              Paste
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  )
}

export const CanvasBaseGridView = forwardRef(CanvasBaseGridViewInner)
