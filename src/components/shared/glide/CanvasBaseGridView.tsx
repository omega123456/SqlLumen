import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
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
  type TextCell,
  type Item,
  type Rectangle,
} from '@glideapps/glide-data-grid'
import { getDefaultColumnWidth } from '../../../lib/grid-column-style'
import type { BaseGridViewProps, GridColumnDescriptor } from '../../../types/shared-data-view'
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
    onRowsChange,
    onScrollPositionChange,
    initialScrollPosition,
    scrollToRowIndex,
    onFkCellAction,
    showInfoColumn = false,
  } = props
  const gridRef = useRef<GridHandle | null>(null)
  useImperativeHandle(ref, () => gridRef.current as GridHandle, [])
  const [internalSelectedRowIndex, setInternalSelectedRowIndex] = useState<number | null>(null)
  const [gridSelection, setGridSelection] = useState<GridSelection | undefined>(undefined)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const lastInteractedCellRef = useRef<{ rowIdx: number; idx: number } | null>(null)
  const activeSelectedRowIndex = selectedRowIndex ?? internalSelectedRowIndex

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
      const rowId = row.id
      if (selectedRows?.has(rowId as string | number) || getRowClass?.(row)?.includes('selected')) {
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
  }, [activeSelectedRowIndex, getRowClass, rows, selectedCellPosition, selectedRows])

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

  useEffect(() => {
    if (!initialScrollPosition) return
    requestAnimationFrame(() => {
      gridRef.current?.scrollToCell({
        idx: Math.max(0, Math.floor(initialScrollPosition.left)),
        rowIdx: Math.max(0, Math.floor(initialScrollPosition.top)),
      })
    })
  }, [initialScrollPosition])

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
        isSelectedRow:
          activeSelectedRowIndex === rowIndex ||
          selectedRows?.has(row.id as string | number) === true ||
          getRowClass?.(row)?.includes('selected') === true,
        isEditingRow: getRowClass?.(row)?.includes('editing-row') === true,
        highlightedColumnKey: highlightColumnKey,
      })
      if (flags.isNull) return buildNullCell(flags.copyValue)
      if (flags.isBlob) return buildBlobCell(flags.displayValue, flags.copyValue)
      const editable = isEditMode === true && editableColumnKeys?.has(column.key) === true
      if (editable) {
        return {
          ...buildTextCell(flags.displayValue, flags, flags.copyValue),
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
      getRowClass,
      gridColumns,
      highlightColumnKey,
      isEditMode,
      isModifiedCell,
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
          if (guard.enableEditor) {
            gridRef.current?.selectCell(
              { rowIdx: guard.targetRowIdx, idx: guard.targetColIdx },
              { shouldFocusCell: true, enableEditor: true }
            )
          }
        }
      }
      void run()
      onCellSelectionChange?.({ rowIdx: rowIndex, columnKey: column.key, rowData: row })
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
      onCellValueChange?.(rowIndex, column.key, next)
      const nextRows = rows.map((row, index) =>
        index === rowIndex ? { ...row, [column.key]: next } : row
      )
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

  const handleVisibleRegionChanged = useCallback(
    (_range: unknown, tx: number, ty: number) => {
      onScrollPositionChange?.(ty, tx)
    },
    [onScrollPositionChange]
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

  const handleKeyDown = useCallback<React.KeyboardEventHandler<HTMLDivElement>>(
    (event) => {
      if (rows.length === 0) return
      const isShortcut = event.metaKey || event.ctrlKey
      if (isShortcut && event.key.toLowerCase() === 'x') {
        event.preventDefault()
        void cutSelectionToClipboard()
        return
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        selectRow(
          activeSelectedRowIndex == null ? 0 : Math.min(rows.length - 1, activeSelectedRowIndex + 1)
        )
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        selectRow(
          activeSelectedRowIndex == null ? rows.length - 1 : Math.max(0, activeSelectedRowIndex - 1)
        )
        return
      }
      if (event.key === 'Enter' && activeSelectedRowIndex != null) {
        const row = rows[activeSelectedRowIndex]
        if (row) {
          event.preventDefault()
          onRowDoubleClicked?.(row)
        }
      }
      if (event.key === 'F4') {
        triggerFkLookupFromSelection(event)
      }
    },
    [
      activeSelectedRowIndex,
      cutSelectionToClipboard,
      gridColumns,
      onRowDoubleClicked,
      rows,
      selectRow,
      triggerFkLookupFromSelection,
    ]
  )

  useEffect(() => {
    const isInteractiveElement = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false
      const tag = target.tagName.toLowerCase()
      return ['button', 'input', 'select', 'textarea', 'a'].includes(tag) || target.isContentEditable
    }

    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== 'F4' || isInteractiveElement(event.target)) {
        return
      }

      triggerFkLookupFromSelection(event)
    }

    document.addEventListener('keydown', handleDocumentKeyDown)
    return () => {
      document.removeEventListener('keydown', handleDocumentKeyDown)
    }
  }, [triggerFkLookupFromSelection])

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
          getRowClass?.(row)?.includes('selected') === true)
      if (column?.key === highlightColumnKey) {
        drawHighlightedColumnBackground(args.ctx, args.rect, args.theme.bgSearchResult)
      }
      if (isSelected) {
        drawHighlightedColumnBackground(args.ctx, args.rect, args.theme.bgBubbleSelected)
        drawSelectedRowAccent(args.ctx, args.rect, args.theme.accentColor)
      }
      if (row != null && getRowClass?.(row)?.includes('editing-row') === true) {
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
      getRowClass,
      gridColumns,
      highlightColumnKey,
      isModifiedCell,
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
