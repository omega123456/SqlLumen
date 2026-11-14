import { useCallback, useMemo, useRef, type ComponentProps, type RefObject } from 'react'
import { useTableDataStore } from '../../../stores/table-data-store'
import type { CanvasBaseGridView } from '../../shared/glide/CanvasBaseGridView'
import type { GridHandle } from '../../shared/glide/glide-grid-types'
import { useSelectionResetKey } from '../../shared/use-selection-reset-key'
import { useBlobViewerState } from '../use-blob-viewer-state'
import {
  draftScrollRowIndex,
  gridSortProps,
  selectedCellPositionOf,
  toSharedTableEditState,
  type TableDataRow,
} from './table-data-grid-model'
import {
  useTableAutoSize,
  useTableGridLayoutCallbacks,
  useTableGridView,
} from './use-table-grid-data'
import { useTableGridCommit } from './use-table-grid-commit'
import { useColumnJump, useDraftRowAutoselect } from './use-table-grid-effects'
import { useTableGridEdits } from './use-table-grid-edits'
import { useTableGridForeignKeys } from './use-table-grid-foreign-keys'
import { useTableCellClickGuard } from './use-table-grid-guards'
import { useTableGridRowCallbacks } from './use-table-grid-row-callbacks'

type CanvasGridProps = ComponentProps<typeof CanvasBaseGridView>

export interface TableDataGridProps {
  tabId: string
  isReadOnly: boolean
  isActive?: boolean
}

function useSortChange(tabId: string, sortColumn: string | undefined) {
  const requestNavigationAction = useTableDataStore((state) => state.requestNavigationAction)
  const sortByColumn = useTableDataStore((state) => state.sortByColumn)
  return useCallback(
    (column: string | null, direction: 'ASC' | 'DESC' | null) => {
      const isSortCleared = !column || !direction
      if (!isSortCleared) {
        const sortDirection = direction.toLowerCase() as 'asc' | 'desc'
        requestNavigationAction(tabId, () => sortByColumn(tabId, column, sortDirection))
        return
      }
      if (!sortColumn) return
      requestNavigationAction(tabId, () => sortByColumn(tabId, sortColumn, null))
    },
    [sortColumn, tabId, requestNavigationAction, sortByColumn]
  )
}

function useBlobDoubleClick(grid: ReturnType<typeof useTableGridView>, props: TableDataGridProps) {
  const { tabId, isReadOnly } = props
  const { descriptorColumns, hasPrimaryKey, primaryKeyColumns } = grid
  const blobViewer = useBlobViewerState({
    tabId: tabId,
    columns: grid.view.columns,
    primaryKeyColumns: primaryKeyColumns,
  })
  const { openBlobViewer } = blobViewer
  const handleCellDoubleClick = useCallback(
    (row: TableDataRow, columnKey: string) => {
      const descriptor = descriptorColumns.find((column) => column.key === columnKey)
      if (!descriptor?.blobViewer) return
      const canEdit = !isReadOnly && hasPrimaryKey && primaryKeyColumns.length > 0
      if (!canEdit) return
      openBlobViewer(columnKey, row)
    },
    [descriptorColumns, isReadOnly, hasPrimaryKey, primaryKeyColumns, openBlobViewer]
  )
  return { blobViewer, handleCellDoubleClick }
}

function useSelectedCellPosition(grid: ReturnType<typeof useTableGridView>) {
  const { descriptorColumns, primaryKeyColumns, rowData } = grid
  const { selectedRowKey, selectedCell } = grid.view
  return useMemo(
    () =>
      selectedCellPositionOf({
        rowData: rowData,
        descriptorColumns: descriptorColumns,
        primaryKeyColumns: primaryKeyColumns,
        selectedRowKey: selectedRowKey,
        selectedCell: selectedCell,
      }),
    [descriptorColumns, primaryKeyColumns, rowData, selectedRowKey, selectedCell]
  )
}

interface TableGridParts {
  props: TableDataGridProps
  grid: ReturnType<typeof useTableGridView>
  canEditRows: boolean
  selectedCellPosition: ReturnType<typeof useSelectedCellPosition>
  handlers: Partial<CanvasGridProps>
}

function buildTableGridProps(parts: TableGridParts): CanvasGridProps {
  const { grid, canEditRows } = parts
  const { view } = grid
  return {
    ...parts.handlers,
    rows: grid.rowData,
    columns: grid.descriptorColumns,
    editState: toSharedTableEditState(view.editState),
    ...gridSortProps(view.sort),
    isEditMode: canEditRows,
    runCellClickGuardOnKeyboardSelection: canEditRows,
    selectedCellPosition: parts.selectedCellPosition,
    initialScrollCell: { scrollRow: view.scrollRow, scrollCol: view.scrollCol },
    scrollToRowIndex: draftScrollRowIndex(view.editState, view.rows.length),
    rowMarkers: 'checkbox',
    testId: 'table-data-grid',
    isActive: parts.props.isActive ?? true,
  }
}

function useEditableColumnKeys(grid: ReturnType<typeof useTableGridView>) {
  const { descriptorColumns } = grid
  return useMemo(
    () =>
      new Set(descriptorColumns.filter((column) => column.editable).map((column) => column.key)),
    [descriptorColumns]
  )
}

type TableGridView = ReturnType<typeof useTableGridView>
type GuardInputs = TableGridView & { tabId: string; commit: ReturnType<typeof useTableGridCommit> }

interface GridHandlerInputs {
  tabId: string
  grid: TableGridView
  guardInputs: GuardInputs
}

function useGridStoreHandlers({ tabId, grid, guardInputs }: GridHandlerInputs) {
  const { view } = grid
  const highlightColumnKey = useTableDataStore(
    (state) => state.highlightedColumnByTab[tabId] ?? undefined
  )
  return {
    ...useTableGridEdits(guardInputs),
    ...useTableGridLayoutCallbacks(tabId, grid.primaryKeyColumns),
    onSortChange: useSortChange(tabId, view.sort?.column),
    onCellClickGuard: useTableCellClickGuard(guardInputs),
    autoSizeConfig: useTableAutoSize(view),
    editableColumnKeys: useEditableColumnKeys(grid),
    highlightColumnKey: highlightColumnKey,
    resetSelectionKey: useSelectionResetKey(view.checkedRowCount),
  }
}

function useTableGridEffects(
  tabId: string,
  grid: TableGridView,
  gridRef: RefObject<GridHandle | null>
) {
  const { view } = grid
  useDraftRowAutoselect({
    gridRef: gridRef,
    editState: view.editState,
    rowCount: view.rows.length,
    selectedRowKey: view.selectedRowKey,
  })
  useColumnJump({ ...grid, tabId: tabId, gridRef: gridRef, selectedRowKey: view.selectedRowKey })
}

export function useTableGridViewModel(props: TableDataGridProps) {
  const { tabId, isReadOnly } = props
  const gridRef = useRef<GridHandle | null>(null)
  const grid = useTableGridView(tabId, isReadOnly)
  const { view } = grid
  const canEditRows = !isReadOnly && grid.hasPrimaryKey
  useTableGridEffects(tabId, grid, gridRef)
  const commit = useTableGridCommit({ tabId: tabId, columns: view.columns })
  const guardInputs = { ...grid, tabId: tabId, commit: commit }
  const selectedCellPosition = useSelectedCellPosition(grid)
  const foreignKeys = useTableGridForeignKeys({
    ...guardInputs,
    gridRef: gridRef,
    selectedCellPosition: selectedCellPosition,
  })
  const { editorCallbacksContext, ...rowHandlers } = useTableGridRowCallbacks({
    ...grid,
    tabId: tabId,
    editState: view.editState,
    selectedRowKey: view.selectedRowKey,
  })
  const storeHandlers = useGridStoreHandlers({ tabId: tabId, grid: grid, guardInputs: guardInputs })
  const blob = useBlobDoubleClick(grid, props)
  const gridProps = buildTableGridProps({
    props: props,
    grid: grid,
    canEditRows: canEditRows,
    selectedCellPosition: selectedCellPosition,
    handlers: {
      ...rowHandlers,
      ...storeHandlers,
      onFkCellAction: foreignKeys.handleForeignKeyCellAction,
      onCellDoubleClick: blob.handleCellDoubleClick,
    },
  })
  return {
    gridRef: gridRef,
    gridProps: gridProps,
    editorCallbacksContext: editorCallbacksContext,
    foreignKeys: foreignKeys,
    blobViewer: blob.blobViewer,
    canEditRows: canEditRows,
    tabState: grid.tabState,
  }
}
