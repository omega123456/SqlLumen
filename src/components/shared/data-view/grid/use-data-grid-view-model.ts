import { useCallback, useMemo, useRef, type ComponentProps } from 'react'
import { useLatestRef } from '../../../../hooks/use-latest-ref'
import type { ResultRow } from '../../../../lib/result-row-materializer'
import type { DataViewSurfaceRef } from '../../../../stores/data-view/data-view-types'
import { routeOf } from '../../../../stores/data-view/route-registry'
import { beginRowAction } from '../../../../stores/data-view/row-action-progress'
import { useDataView } from '../../../../stores/data-view/use-data-view'
import { editableColumnKeysOf } from '../grid-column-descriptor'
import { useBlobViewer } from '../use-blob-viewer'
import { useForeignKeyLookup, type GridFocusTarget } from '../use-foreign-key-lookup'
import { useGridEditHandlers, type GridEditHandlers } from '../use-grid-edit-handlers'
import { useDataEditSession } from '../use-data-edit-session'
import type { DataViewSource } from '../data-view-source'
import type { CanvasBaseGridView, GridRowActions } from '../../glide/CanvasBaseGridView'
import type { GridHandle } from '../../glide/glide-grid-types'
import {
  dataRowClass,
  draftScrollRowIndex,
  editLocationOf,
  invertColumnBindings,
  selectedCellPositionOf,
  toSharedEditState,
} from './data-grid-model'
import { useDataGridColumns } from './use-data-grid-columns'
import { useDataGridSort } from './use-data-grid-sort'
import { useDataGridLayout } from './use-data-grid-layout'
import { useDataRowSource } from './use-data-row-source'
import { useDeferredSelection } from './use-deferred-selection'
import { useDataColumnJump } from './use-data-column-jump'

type CanvasGridProps = ComponentProps<typeof CanvasBaseGridView>

const EMPTY_ROWS: ResultRow[] = []

function rowKeyOf(row: Record<string, unknown>): string {
  return String(row.__rowIdx)
}

function useGridView(ref: DataViewSurfaceRef) {
  return {
    slot: useDataView(ref, (view) => view.slot),
    edit: useDataView(ref, (view) => view.edit),
    editTarget: useDataView(ref, (view) => view.editTarget),
    selectedRowIndex: useDataView(ref, (view) => view.selection.rowIndex),
    sort: useDataView(ref, (view) => view.spec.sort),
  }
}

type GridView = ReturnType<typeof useGridView>

interface DerivedGridInputs {
  boundColumnIndexLookup: Map<string, number>
  selectedCell: { columnKey: string } | null
}

function useDerivedGridState(
  { slot, edit, selectedRowIndex }: GridView,
  { boundColumnIndexLookup, selectedCell }: DerivedGridInputs
) {
  const columns = slot.columns
  const selectedCellPosition = useMemo(
    () => selectedCellPositionOf({ columns, selectedCell, selectedRowIndex }),
    [columns, selectedCell, selectedRowIndex]
  )
  const sharedEditState = useMemo(
    () => toSharedEditState(edit.state, boundColumnIndexLookup),
    [edit.state, boundColumnIndexLookup]
  )
  const getRowClass = useCallback(
    (row: Record<string, unknown>) =>
      dataRowClass(row, { selectedRowIndex: selectedRowIndex, edit: edit }),
    [selectedRowIndex, edit]
  )
  return { selectedCellPosition, sharedEditState, getRowClass }
}

function useGridRowActions(ref: DataViewSurfaceRef): GridRowActions {
  return useMemo<GridRowActions>(
    () => ({
      begin: (verb, total, onCancel) =>
        beginRowAction(ref, { verb: verb, total: total, onCancel: onCancel }),
      onExpired: () => routeOf(ref).lifecycle.onExpired(ref),
    }),
    [ref]
  )
}

function useBoundColumnIndexLookup({ editTarget }: GridView) {
  const bindings = editTarget.bindings
  return useMemo(() => invertColumnBindings(bindings), [bindings])
}

function useEditLocation({ slot, editTarget }: GridView) {
  const connectionId = slot.connectionId
  return useMemo(() => editLocationOf(connectionId, editTarget), [connectionId, editTarget])
}

interface DataGridParts {
  source: DataViewSource
  view: GridView
  rowSource: CanvasGridProps['rowSource']
  columns: ReturnType<typeof useDataGridColumns>
  layout: ReturnType<typeof useDataGridLayout>
  sort: ReturnType<typeof useDataGridSort>
  editHandlers: Omit<GridEditHandlers, 'editorCallbacksContext'>
  derived: ReturnType<typeof useDerivedGridState>
  rowActions: GridRowActions
  cellActions: Pick<
    CanvasGridProps,
    'onFkCellAction' | 'onCellDoubleClick' | 'onCellSelectionChange' | 'highlightColumnKey'
  >
}

function buildDataGridProps(parts: DataGridParts): CanvasGridProps {
  const { source, view, layout, sort, derived } = parts
  const isEditMode = view.editTarget.tableName !== null
  return {
    ...parts.editHandlers,
    ...parts.cellActions,
    rows: EMPTY_ROWS,
    rowSource: parts.rowSource,
    rowActions: parts.rowActions,
    columns: parts.columns.gridColumns,
    editState: derived.sharedEditState,
    sortColumn: sort.sortColumnKey,
    sortDirection: sort.sortDirectionUpper,
    onSortChange: sort.handleSortChange,
    runCellClickGuardOnKeyboardSelection: isEditMode,
    isEditMode: isEditMode,
    selectedCellPosition: derived.selectedCellPosition,
    editableColumnKeys: editableColumnKeysOf(parts.columns.gridColumns),
    rowKeyGetter: rowKeyOf,
    getRowClass: derived.getRowClass,
    selectedRowIndex: view.selectedRowIndex,
    scrollToRowIndex: draftScrollRowIndex(view.edit),
    autoSizeConfig: parts.columns.autoSizeConfig,
    isActive: source.isActive,
    onScrollCellChange: layout.handleScrollCellChange,
    onColumnResize: layout.handleColumnResize,
    initialScrollCell: layout.initialScrollCell,
    rowMarkers: 'checkbox',
    initialCheckedRanges: layout.initialCheckedRanges,
    onRowMarkerRangesChange: layout.handleRowMarkerRangesChange,
    resetSelectionKey: layout.resetSelectionKey,
    testId: source.testIds.grid,
  }
}

function useRowLookup(
  source: DataViewSource,
  view: GridView,
  boundColumnIndexLookup: Map<string, number>
) {
  const rowSource = useDataRowSource({
    ref: source.ref,
    slot: view.slot,
    edit: view.edit,
    boundColumnIndexLookup: boundColumnIndexLookup,
  })
  const rowSourceRef = useLatestRef(rowSource)
  const rowAt = useCallback(
    (rowIndex: number) => rowSourceRef.current.getRow(rowIndex),
    [rowSourceRef]
  )
  return { rowSource, rowAt }
}

interface GridCellInteractionInputs {
  source: DataViewSource
  view: GridView
  session: ReturnType<typeof useDataEditSession>
  gridColumns: ReturnType<typeof useDataGridColumns>['gridColumns']
  gridFocus: GridFocusTarget
}

function useGridCellInteractions(inputs: GridCellInteractionInputs) {
  const { source, view, session, gridColumns, gridFocus } = inputs
  const ref = source.ref
  const isEditMode = view.editTarget.tableName !== null
  const foreignKeyLookup = useForeignKeyLookup({
    session: session,
    columns: gridColumns,
    isActive: source.isActive,
    gridFocus: gridFocus,
  })
  const blobViewer = useBlobViewer({ session: session, columns: gridColumns })
  const deferredSelection = useDeferredSelection(ref, view.slot)
  const columnJump = useDataColumnJump({
    ref: ref,
    gridRef: gridFocus.gridRef,
    columns: view.slot.columns,
    columnJump: source.capabilities.columnJump,
    onCellSelectionChange: isEditMode ? undefined : deferredSelection,
  })
  const cellActions: DataGridParts['cellActions'] = {
    onFkCellAction: foreignKeyLookup.onFkCellAction,
    onCellDoubleClick: blobViewer.openBlobViewer,
    onCellSelectionChange: columnJump.handleCellSelectionChange,
    highlightColumnKey: columnJump.highlightColumnKey,
  }
  return { foreignKeyLookup, blobViewer, cellActions }
}

export function useDataGridViewModel(source: DataViewSource) {
  const ref = source.ref
  const view = useGridView(ref)
  const gridRef = useRef<GridHandle | null>(null)
  const layout = useDataGridLayout(ref, view.slot.viewRowCount)
  const boundColumnIndexLookup = useBoundColumnIndexLookup(view)
  const { rowSource, rowAt } = useRowLookup(source, view, boundColumnIndexLookup)
  const dataColumns = useDataGridColumns({
    columns: view.slot.columns,
    editTarget: view.editTarget,
    metadata: source.capabilities.columnMetadata,
    columnWidths: layout.columnWidths,
  })
  const { gridColumns } = dataColumns
  const session = useDataEditSession(ref)
  const { editorCallbacksContext, ...editHandlers } = useGridEditHandlers({
    session: session,
    rowAt: rowAt,
    columns: gridColumns,
  })
  const derived = useDerivedGridState(view, {
    boundColumnIndexLookup: boundColumnIndexLookup,
    selectedCell: layout.selectedCell,
  })
  const { foreignKeyLookup, blobViewer, cellActions } = useGridCellInteractions({
    source: source,
    view: view,
    session: session,
    gridColumns: gridColumns,
    gridFocus: { gridRef: gridRef, selectedCellPosition: derived.selectedCellPosition },
  })
  const sort = useDataGridSort({ ref: ref, columns: view.slot.columns, sort: view.sort })
  const rowActions = useGridRowActions(ref)
  const editLocation = useEditLocation(view)
  const gridProps = buildDataGridProps({
    source: source,
    view: view,
    rowSource: rowSource,
    columns: dataColumns,
    layout: layout,
    sort: sort,
    editHandlers: editHandlers,
    derived: derived,
    rowActions: rowActions,
    cellActions: cellActions,
  })

  return {
    gridRef: gridRef,
    gridProps: gridProps,
    editorCallbacksContext: editorCallbacksContext,
    foreignKeyLookup: foreignKeyLookup,
    blobViewer: blobViewer,
    editLocation: editLocation,
  }
}
