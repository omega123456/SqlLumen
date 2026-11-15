import { useCallback, useMemo, useRef, type ComponentProps, type RefObject } from 'react'
import { useTableDataStore } from '../../../stores/table-data-store'
import type { CanvasBaseGridView } from '../../shared/glide/CanvasBaseGridView'
import type { GridHandle } from '../../shared/glide/glide-grid-types'
import { useSelectionResetKey } from '../../shared/use-selection-reset-key'
import { editableColumnKeysOf } from '../../shared/data-view/grid-column-descriptor'
import { useBlobViewer } from '../../shared/data-view/use-blob-viewer'
import { useForeignKeyLookup } from '../../shared/data-view/use-foreign-key-lookup'
import {
  useGridEditHandlers,
  useReleaseUnmodifiedChangedRows,
} from '../../shared/data-view/use-grid-edit-handlers'
import { useTableEditSession } from '../table-data-edit-session'
import {
  draftScrollRowIndex,
  gridSortProps,
  selectedCellPositionOf,
  toSharedTableEditState,
} from './table-data-grid-model'
import {
  useTableAutoSize,
  useTableGridLayoutCallbacks,
  useTableGridView,
} from './use-table-grid-data'
import { useColumnJump, useDraftRowAutoselect } from './use-table-grid-effects'
import {
  useClearHighlightOnPointerSelection,
  useTableRowPresentation,
} from './use-table-grid-row-callbacks'

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

type TableGridView = ReturnType<typeof useTableGridView>

function useGridStoreHandlers(tabId: string, grid: TableGridView) {
  const { view, descriptorColumns } = grid
  const highlightColumnKey = useTableDataStore(
    (state) => state.highlightedColumnByTab[tabId] ?? undefined
  )
  const editableColumnKeys = useMemo(
    () => editableColumnKeysOf(descriptorColumns),
    [descriptorColumns]
  )
  return {
    ...useTableGridLayoutCallbacks(tabId, grid.primaryKeyColumns),
    ...useTableRowPresentation({
      primaryKeyColumns: grid.primaryKeyColumns,
      editState: view.editState,
      selectedRowKey: view.selectedRowKey,
    }),
    onCellSelectionChange: useClearHighlightOnPointerSelection(tabId),
    onSortChange: useSortChange(tabId, view.sort?.column),
    autoSizeConfig: useTableAutoSize(view),
    editableColumnKeys: editableColumnKeys,
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

function useTableGridRowLookup(grid: TableGridView) {
  const { rowDataRef } = grid
  return useCallback((rowIndex: number) => rowDataRef.current[rowIndex], [rowDataRef])
}

export function useTableGridViewModel(props: TableDataGridProps) {
  const { tabId, isReadOnly } = props
  const gridRef = useRef<GridHandle | null>(null)
  const grid = useTableGridView(tabId, isReadOnly)
  const { view, descriptorColumns } = grid
  const canEditRows = !isReadOnly && grid.hasPrimaryKey
  useTableGridEffects(tabId, grid, gridRef)
  const session = useTableEditSession({
    tabId: tabId,
    columns: view.columns,
    primaryKeyColumns: grid.primaryKeyColumns,
    descriptorColumns: descriptorColumns,
    canEditRows: canEditRows,
  })
  const rowAt = useTableGridRowLookup(grid)
  const { editorCallbacksContext, ...editHandlers } = useGridEditHandlers({
    session: session,
    rowAt: rowAt,
    columns: descriptorColumns,
  })
  const onRowsChange = useReleaseUnmodifiedChangedRows(session)
  const selectedCellPosition = useSelectedCellPosition(grid)
  const foreignKeyLookup = useForeignKeyLookup({
    session: session,
    columns: descriptorColumns,
    isActive: props.isActive ?? true,
    gridFocus: { gridRef: gridRef, selectedCellPosition: selectedCellPosition },
  })
  const blobViewer = useBlobViewer({ session: session, columns: descriptorColumns })
  const storeHandlers = useGridStoreHandlers(tabId, grid)
  const gridProps = buildTableGridProps({
    props: props,
    grid: grid,
    canEditRows: canEditRows,
    selectedCellPosition: selectedCellPosition,
    handlers: {
      ...editHandlers,
      ...storeHandlers,
      onRowsChange: onRowsChange,
      onFkCellAction: foreignKeyLookup.onFkCellAction,
      onCellDoubleClick: blobViewer.openBlobViewer,
    },
  })
  return {
    gridRef: gridRef,
    gridProps: gridProps,
    editorCallbacksContext: editorCallbacksContext,
    foreignKeyLookup: foreignKeyLookup,
    blobViewer: blobViewer,
    tabState: grid.tabState,
  }
}
