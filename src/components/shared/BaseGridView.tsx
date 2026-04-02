/**
 * BaseGridView — shared react-data-grid wrapper for both query results and
 * table data browsing.
 *
 * Implements BaseGridViewProps from shared-data-view.ts. Features:
 * - Controlled column widths with auto-sizing support
 * - Sort state derivation and single-sort enforcement
 * - Cell click guard pattern for async validation before cell selection
 * - Keyboard copy/paste/cut and cell context menu
 * - Tab-to-next-cell editor activation
 * - Anti-focus-loss editStateRef pattern for stable column definitions
 * - Forwarded ref to DataGridHandle for external cell selection
 *
 * This component does NOT import from any Zustand store — all data and
 * callbacks are received via props, making it fully reusable.
 */

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
import { createPortal } from 'react-dom'
import { ClipboardText, CopySimple, Scissors } from '@phosphor-icons/react'
import type {
  CellKeyDownArgs,
  CellKeyboardEvent,
  CellMouseArgs,
  CellMouseEvent,
  CellSelectArgs,
  ColumnWidth,
  RowsChangeData,
} from 'react-data-grid'
import { DataGrid } from './DataGrid'
import type { Column, SortColumn, DataGridHandle } from './DataGrid'
import { TableDataCellRenderer } from './grid-cell-renderers'
import { ReadOnlyColumnHeaderCell } from './grid-header-renderers'
import { getCellEditorForColumn } from './grid-cell-editors'
import type { CellEditorCallbackProps } from './grid-cell-editors'
import { getGridCellClass, getDefaultColumnWidth } from '../../lib/grid-column-style'
import {
  getContextMenuPortalRoot,
  positionContextMenuInPortal,
  readClipboardText,
  writeClipboardText,
} from '../../lib/context-menu-utils'
import { DISMISS_ALL_CONTEXT_MENUS, dispatchDismissAll } from '../../lib/context-menu-events'
import type {
  BaseGridViewProps,
  CellClickGuardArgs,
  CellClipboardEditArgs,
} from '../../types/shared-data-view'
import styles from './BaseGridView.module.css'

const NOOP_EDITOR_CALLBACKS: CellEditorCallbackProps = {
  tabId: '',
  updateCellValue: () => {},
  syncCellValue: () => {},
}

type GridRow = Record<string, unknown>
type ColumnWidthsMap = ReadonlyMap<string, ColumnWidth>

interface CellContextMenuState {
  x: number
  y: number
  rowIdx: number
  row: GridRow
  column: {
    key: string
    idx: number
    editable: boolean
  }
  portalRoot: HTMLElement
}

function columnKeysFingerprint(columns: { key: string }[]): string {
  return columns.map((c) => c.key).join('\x00')
}

function getClipboardText(value: unknown): string {
  return value == null ? 'NULL' : String(value)
}

function isClipboardShortcut(
  event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'key'>,
  key: string
) {
  return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === key
}

function BaseGridViewInner(props: BaseGridViewProps, ref: React.Ref<DataGridHandle>) {
  const {
    rows,
    columns,
    editState,
    sortColumn,
    sortDirection,
    onSortChange,
    onCellClickGuard,
    onCellClipboardEdit,
    onColumnResize: onColumnResizeProp,
    onRowsChange: onRowsChangeProp,
    rowKeyGetter: rowKeyGetterProp,
    getRowClass: getRowClassProp,
    isModifiedCell,
    autoSizeConfig,
    showReadOnlyHeaders,
    testId,
  } = props

  const gridRef = useRef<DataGridHandle | null>(null)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  const pendingTabNavigationRef = useRef<{ rowIdx: number; idx: number } | null>(null)

  useImperativeHandle(ref, () => gridRef.current as DataGridHandle, [])

  const editStateRef = useRef(editState)
  editStateRef.current = editState

  const isModifiedCellRef = useRef(isModifiedCell)
  isModifiedCellRef.current = isModifiedCell

  const [columnWidths, setColumnWidths] = useState<ColumnWidthsMap>(() => new Map())
  const [cellContextMenu, setCellContextMenu] = useState<CellContextMenuState | null>(null)
  const prevColumnKeysRef = useRef<string>(columnKeysFingerprint(columns))

  useEffect(() => {
    const currentKeys = columnKeysFingerprint(columns)
    if (currentKeys !== prevColumnKeysRef.current) {
      prevColumnKeysRef.current = currentKeys
      setColumnWidths(new Map())
    }
  }, [columns])

  useEffect(() => {
    if (!cellContextMenu) return

    const handleDismissAll = () => setCellContextMenu(null)
    document.addEventListener(DISMISS_ALL_CONTEXT_MENUS, handleDismissAll)
    return () => {
      document.removeEventListener(DISMISS_ALL_CONTEXT_MENUS, handleDismissAll)
    }
  }, [cellContextMenu])

  useEffect(() => {
    if (!cellContextMenu) return

    const handleMouseDown = (event: MouseEvent) => {
      if (contextMenuRef.current?.contains(event.target as Node)) return
      setCellContextMenu(null)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCellContextMenu(null)
      }
    }

    window.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [cellContextMenu])

  useLayoutEffect(() => {
    if (!cellContextMenu || !contextMenuRef.current) return

    const rect = contextMenuRef.current.getBoundingClientRect()
    const pos = positionContextMenuInPortal(
      cellContextMenu.portalRoot,
      cellContextMenu.x,
      cellContextMenu.y,
      rect.width,
      rect.height
    )
    contextMenuRef.current.style.left = `${pos.x}px`
    contextMenuRef.current.style.top = `${pos.y}px`
  }, [cellContextMenu])

  const autoColumnWidthsRef = useRef<Record<string, number>>({})

  const autoColumnWidths = useMemo(() => {
    if (!autoSizeConfig?.enabled) return autoColumnWidthsRef.current
    if (editState != null) return autoColumnWidthsRef.current

    const widths: Record<string, number> = {}
    for (const col of columns) {
      widths[col.key] = autoSizeConfig.computeWidth(col, rows)
    }
    autoColumnWidthsRef.current = widths
    return widths
  }, [autoSizeConfig, columns, rows, editState])

  const handleColumnResize = useCallback(
    (column: { key: string }, width: number) => {
      onColumnResizeProp?.(column.key, width)
    },
    [onColumnResizeProp]
  )

  const handleColumnWidthsChange = useCallback((nextColumnWidths: ColumnWidthsMap) => {
    setColumnWidths(nextColumnWidths)
  }, [])

  const sortColumnsRdg: readonly SortColumn[] = useMemo(() => {
    if (sortColumn && sortDirection) {
      return [{ columnKey: sortColumn, direction: sortDirection }]
    }
    return []
  }, [sortColumn, sortDirection])

  const handleSortColumnsChange = useCallback(
    (newSortColumns: SortColumn[]) => {
      if (!onSortChange) return

      const lastSort =
        newSortColumns.length > 0 ? newSortColumns[newSortColumns.length - 1] : undefined

      if (!lastSort) {
        onSortChange(null, null)
        return
      }

      onSortChange(lastSort.columnKey, lastSort.direction as 'ASC' | 'DESC')
    },
    [onSortChange]
  )

  const rdgColumns: readonly Column<GridRow>[] = useMemo(() => {
    const pkColumnNames = columns.filter((c) => c.isPrimaryKey).map((c) => c.key)

    return columns.map((col) => {
      const colWidth = autoColumnWidths[col.key] ?? getDefaultColumnWidth(col.dataType)

      const baseCellClass = getGridCellClass(col.key, col.dataType, pkColumnNames)

      const cellClass = (row: GridRow) => {
        const classes = [baseCellClass]

        if (col.editable) {
          classes.push('rdg-editable-cell')
        } else {
          classes.push('rdg-readonly-cell')
        }

        if (editStateRef.current && isModifiedCellRef.current) {
          if (isModifiedCellRef.current(row, col.key)) {
            classes.push('rdg-modified-cell')
          }
        }

        return classes.join(' ')
      }

      const baseProps = {
        key: col.key,
        name: col.displayName,
        width: colWidth,
        resizable: true,
        sortable: !!onSortChange,
        renderCell: TableDataCellRenderer,
        cellClass,
      }

      if (col.editable && col.tableColumnMeta) {
        const editorConfig = getCellEditorForColumn(col.tableColumnMeta, NOOP_EDITOR_CALLBACKS)
        return {
          ...baseProps,
          renderEditCell: editorConfig.renderEditCell,
          ...(editorConfig.editorOptions && { editorOptions: editorConfig.editorOptions }),
        } as Column<GridRow>
      }

      if (showReadOnlyHeaders && !col.editable) {
        return {
          ...baseProps,
          renderHeaderCell: ReadOnlyColumnHeaderCell,
          headerCellClass: 'rdg-readonly-cell',
        } as Column<GridRow>
      }

      return baseProps as Column<GridRow>
    })
  }, [columns, autoColumnWidths, onSortChange, showReadOnlyHeaders])

  const handleCellClick = useCallback(
    async (args: CellMouseArgs<GridRow>, event: CellMouseEvent) => {
      if (!onCellClickGuard) return

      event.preventGridDefault()

      const guardArgs: CellClickGuardArgs = {
        rowIdx: args.rowIdx,
        columnKey: args.column.key,
        rowData: args.row,
      }

      const result = await onCellClickGuard(guardArgs)

      if (result.proceed) {
        gridRef.current?.selectCell(
          { rowIdx: result.targetRowIdx, idx: result.targetColIdx },
          { enableEditor: result.enableEditor }
        )
      }
    },
    [onCellClickGuard]
  )

  const handleRowsChange = useCallback(
    (newRows: GridRow[], data: RowsChangeData<GridRow>) => {
      onRowsChangeProp?.(newRows, data)
    },
    [onRowsChangeProp]
  )

  const handleSelectedCellChange = useCallback((args: CellSelectArgs<GridRow>) => {
    const target = pendingTabNavigationRef.current
    if (!target) return

    const editable =
      typeof args.column.editable === 'boolean'
        ? args.column.editable
        : args.column.renderEditCell != null

    if (target.rowIdx === args.rowIdx && target.idx === args.column.idx && editable) {
      gridRef.current?.selectCell(
        { rowIdx: args.rowIdx, idx: args.column.idx },
        { enableEditor: true, shouldFocusCell: true }
      )
    }

    pendingTabNavigationRef.current = null
  }, [])

  const handleCellClipboardEdit = useCallback(
    async (args: CellClipboardEditArgs) => {
      await onCellClipboardEdit?.(args)
    },
    [onCellClipboardEdit]
  )

  const handleCellKeyDown = useCallback(
    (args: CellKeyDownArgs<GridRow>, event: CellKeyboardEvent) => {
      if (args.mode === 'EDIT' && event.key === 'Tab') {
        const direction = event.shiftKey ? -1 : 1
        const nextIdx = args.column.idx + direction
        if (nextIdx >= 0 && nextIdx < columns.length) {
          pendingTabNavigationRef.current = { rowIdx: args.rowIdx, idx: nextIdx }
        } else {
          pendingTabNavigationRef.current = null
        }
        return
      }

      if (args.mode !== 'SELECT') return

      if (isClipboardShortcut(event, 'c')) {
        event.preventGridDefault()
        void writeClipboardText(getClipboardText(args.row[args.column.key])).catch((err) => {
          console.error('[base-grid-view] clipboard write failed:', err)
        })
        return
      }

      const selectedColumn = columns.find((col) => col.key === args.column.key)
      if (!selectedColumn?.editable) return

      if (isClipboardShortcut(event, 'x')) {
        event.preventGridDefault()
        void (async () => {
          try {
            await writeClipboardText(getClipboardText(args.row[args.column.key]))
            await handleCellClipboardEdit({
              rowIdx: args.rowIdx,
              rowData: args.row,
              columnKey: args.column.key,
              action: 'cut',
            })
          } catch (err) {
            console.error('[base-grid-view] cut failed:', err)
          }
        })()
        return
      }

      if (isClipboardShortcut(event, 'v')) {
        event.preventGridDefault()
        void (async () => {
          try {
            const text = await readClipboardText()
            await handleCellClipboardEdit({
              rowIdx: args.rowIdx,
              rowData: args.row,
              columnKey: args.column.key,
              action: 'paste',
              text,
            })
          } catch (err) {
            console.error('[base-grid-view] paste failed:', err)
          }
        })()
      }
    },
    [columns, handleCellClipboardEdit]
  )

  const handleCellContextMenu = useCallback(
    (args: CellMouseArgs<GridRow>, event: CellMouseEvent) => {
      event.preventDefault()
      event.preventGridDefault()
      dispatchDismissAll()

      const editable =
        typeof args.column.editable === 'boolean'
          ? args.column.editable
          : args.column.renderEditCell != null

      setCellContextMenu({
        x: event.clientX,
        y: event.clientY,
        rowIdx: args.rowIdx,
        row: args.row,
        column: {
          key: args.column.key,
          idx: args.column.idx,
          editable,
        },
        portalRoot: getContextMenuPortalRoot(event.target as Element | null),
      })
    },
    []
  )

  const handleContextMenuAction = useCallback(
    (action: 'copy' | 'cut' | 'paste') => {
      if (!cellContextMenu) return

      void (async () => {
        try {
          if (action === 'copy') {
            await writeClipboardText(
              getClipboardText(cellContextMenu.row[cellContextMenu.column.key])
            )
            return
          }

          if (!cellContextMenu.column.editable) return

          if (action === 'cut') {
            await writeClipboardText(
              getClipboardText(cellContextMenu.row[cellContextMenu.column.key])
            )
            await handleCellClipboardEdit({
              rowIdx: cellContextMenu.rowIdx,
              rowData: cellContextMenu.row,
              columnKey: cellContextMenu.column.key,
              action: 'cut',
            })
            return
          }

          const text = await readClipboardText()
          await handleCellClipboardEdit({
            rowIdx: cellContextMenu.rowIdx,
            rowData: cellContextMenu.row,
            columnKey: cellContextMenu.column.key,
            action: 'paste',
            text,
          })
        } catch (err) {
          console.error('[base-grid-view] context menu action failed:', err)
        } finally {
          setCellContextMenu(null)
        }
      })()
    },
    [cellContextMenu, handleCellClipboardEdit]
  )

  const contextMenuPortal =
    cellContextMenu == null
      ? null
      : createPortal(
          <div
            ref={contextMenuRef}
            className="ui-context-menu"
            style={{ left: cellContextMenu.x, top: cellContextMenu.y }}
            role="menu"
            data-testid="grid-cell-context-menu"
            onMouseDown={(event) => event.preventDefault()}
          >
            <button
              type="button"
              className="ui-context-menu__item"
              role="menuitem"
              data-testid="grid-cell-context-copy"
              onClick={() => handleContextMenuAction('copy')}
            >
              <span className="ui-context-menu__icon">
                <CopySimple size={16} />
              </span>
              <span>Copy</span>
            </button>
            <button
              type="button"
              className="ui-context-menu__item"
              role="menuitem"
              data-testid="grid-cell-context-cut"
              disabled={!cellContextMenu.column.editable}
              onClick={() => handleContextMenuAction('cut')}
            >
              <span className="ui-context-menu__icon">
                <Scissors size={16} />
              </span>
              <span>Cut</span>
            </button>
            <button
              type="button"
              className="ui-context-menu__item"
              role="menuitem"
              data-testid="grid-cell-context-paste"
              disabled={!cellContextMenu.column.editable}
              onClick={() => handleContextMenuAction('paste')}
            >
              <span className="ui-context-menu__icon">
                <ClipboardText size={16} />
              </span>
              <span>Paste</span>
            </button>
          </div>,
          cellContextMenu.portalRoot
        )

  return (
    <div className={styles.container} data-testid={testId ?? 'base-grid-view'}>
      <DataGrid<GridRow>
        ref={gridRef}
        columns={rdgColumns}
        rows={rows}
        columnWidths={columnWidths}
        onColumnWidthsChange={handleColumnWidthsChange}
        sortColumns={sortColumnsRdg}
        onSortColumnsChange={onSortChange ? handleSortColumnsChange : undefined}
        onCellClick={handleCellClick}
        onCellContextMenu={handleCellContextMenu}
        onCellKeyDown={handleCellKeyDown}
        onSelectedCellChange={handleSelectedCellChange}
        onRowsChange={handleRowsChange}
        onColumnResize={handleColumnResize}
        rowKeyGetter={rowKeyGetterProp}
        rowClass={getRowClassProp}
        data-testid={testId ? `${testId}-inner` : 'base-grid-view-inner'}
      />
      {contextMenuPortal}
    </div>
  )
}

export const BaseGridView = forwardRef(BaseGridViewInner) as (
  props: BaseGridViewProps & { ref?: React.Ref<DataGridHandle> }
) => React.ReactElement | null
