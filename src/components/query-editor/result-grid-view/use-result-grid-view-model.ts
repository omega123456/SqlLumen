import { useCallback, useMemo, useRef, type ComponentProps } from 'react'
import { useLatestRef } from '../../../hooks/use-latest-ref'
import type { ResultRow } from '../../../lib/result-row-materializer'
import type { ForeignKeyColumnInfo } from '../../../types/schema'
import { editableColumnKeysOf } from '../../shared/data-view/grid-column-descriptor'
import { useBlobViewer } from '../../shared/data-view/use-blob-viewer'
import { useForeignKeyLookup } from '../../shared/data-view/use-foreign-key-lookup'
import {
  useGridEditHandlers,
  type GridEditHandlers,
} from '../../shared/data-view/use-grid-edit-handlers'
import type { CanvasBaseGridView } from '../../shared/glide/CanvasBaseGridView'
import type { GridHandle } from '../../shared/glide/glide-grid-types'
import { useResultEditSession } from '../result-edit-session'
import { SELECTED_ROW_CLASS } from '../../shared/data-view/row-class-names'
import {
  invertColumnBindings,
  resultRowClass,
  selectedCellPositionOf,
  toSharedEditState,
  type ResultGridViewProps,
} from './result-grid-model'
import { useResultGridColumns } from './use-result-grid-columns'
import { useResultGridSort } from './use-result-grid-sort'
import { useResultGridStoreState } from './use-result-grid-store-state'
import { useResultRowSource } from './use-result-row-source'
import { useDeferredReadOnlySelection } from './use-result-selection-sync'

type CanvasGridProps = ComponentProps<typeof CanvasBaseGridView>

const EMPTY_FOREIGN_KEYS: ForeignKeyColumnInfo[] = []
const EMPTY_ROWS: ResultRow[] = []
const IGNORE_DISCARD = () => {}

function rowKeyOf(row: Record<string, unknown>): string {
  return String(row.__rowIdx)
}

interface DerivedGridInputs {
  boundColumnIndexLookup: Map<string, number>
  selectedCell: { columnKey: string } | null
}

function useDerivedGridState(
  props: ResultGridViewProps,
  { boundColumnIndexLookup, selectedCell }: DerivedGridInputs
) {
  const { columns, selectedRowIndex, editState, editingRowIndex, editingBaseIndex } = props
  const selectedCellPosition = useMemo(
    () => selectedCellPositionOf({ columns, selectedCell, selectedRowIndex }),
    [columns, selectedCell, selectedRowIndex]
  )
  const sharedEditState = useMemo(
    () => toSharedEditState(editState, boundColumnIndexLookup),
    [editState, boundColumnIndexLookup]
  )
  const isEditingNewRow = editState?.isNewRow === true
  const getRowClass = useCallback(
    (row: Record<string, unknown>) =>
      resultRowClass(row, { selectedRowIndex, editingRowIndex, editingBaseIndex, isEditingNewRow }),
    [selectedRowIndex, editingRowIndex, editingBaseIndex, isEditingNewRow]
  )
  return { selectedCellPosition, sharedEditState, getRowClass }
}

function useResultSession(props: ResultGridViewProps) {
  return useResultEditSession({
    tabId: props.tabId,
    queryId: props.queryId,
    viewVersion: props.viewVersion,
    columns: props.columns,
    editMode: props.editMode,
    editableColumnMap: props.editableColumnMap,
    editState: props.editState,
    editingRowIndex: props.editingRowIndex,
    editingBaseIndex: props.editingBaseIndex,
    editTableColumns: props.editTableColumns,
    editColumnBindings: props.editColumnBindings,
    onStartEditing: props.onStartEditing,
    onUpdateCellValue: props.onUpdateCellValue,
    onSyncCellValue: props.onSyncCellValue,
    onSaveRow: props.onAutoSave,
    onDiscardRow: props.onDiscardRow ?? IGNORE_DISCARD,
    onRowSelected: props.onRowSelected,
  })
}

interface ResultGridParts {
  props: ResultGridViewProps
  rowSource: CanvasGridProps['rowSource']
  columns: ReturnType<typeof useResultGridColumns>
  storeState: ReturnType<typeof useResultGridStoreState>
  sort: ReturnType<typeof useResultGridSort>
  editHandlers: Omit<GridEditHandlers, 'editorCallbacksContext'>
  derived: ReturnType<typeof useDerivedGridState>
  cellActions: Pick<
    CanvasGridProps,
    'onFkCellAction' | 'onCellDoubleClick' | 'onCellSelectionChange'
  >
}

function buildResultGridProps(parts: ResultGridParts): CanvasGridProps {
  const { props, storeState, sort, derived } = parts
  const isEditMode = Boolean(props.editMode)
  return {
    ...parts.editHandlers,
    ...parts.cellActions,
    rows: EMPTY_ROWS,
    rowSource: parts.rowSource,
    rowActions: props.rowActions,
    columns: parts.columns.gridColumns,
    editState: derived.sharedEditState,
    sortColumn: sort.sortColumnKey,
    sortDirection: sort.sortDirectionUpper,
    onSortChange: sort.handleSortChange,
    runCellClickGuardOnKeyboardSelection: isEditMode,
    isEditMode: isEditMode,
    selectedRowClassName: isEditMode ? undefined : SELECTED_ROW_CLASS,
    showReadOnlyHeaders: isEditMode,
    selectedCellPosition: derived.selectedCellPosition,
    editableColumnKeys: editableColumnKeysOf(parts.columns.gridColumns),
    rowKeyGetter: rowKeyOf,
    getRowClass: derived.getRowClass,
    selectedRowIndex: props.selectedRowIndex,
    autoSizeConfig: parts.columns.autoSizeConfig,
    isActive: props.isActive ?? true,
    onScrollCellChange: storeState.handleScrollCellChange,
    onColumnResize: storeState.handleColumnResize,
    initialScrollCell: storeState.initialScrollCell,
    rowMarkers: 'checkbox',
    onRowMarkerRangesChange: storeState.handleRowMarkerRangesChange,
    resetSelectionKey: storeState.resetSelectionKey,
    testId: 'result-grid',
  }
}

function useResultRowLookup(
  props: ResultGridViewProps,
  boundColumnIndexLookup: Map<string, number>
) {
  const rowSource = useResultRowSource({
    ...props,
    columnCount: props.columns.length,
    boundColumnIndexLookup: boundColumnIndexLookup,
  })
  const rowSourceRef = useLatestRef(rowSource)
  const rowAt = useCallback(
    (rowIndex: number) => rowSourceRef.current.getRow(rowIndex),
    [rowSourceRef]
  )
  return { rowSource, rowAt }
}

export function useResultGridViewModel(props: ResultGridViewProps) {
  const { tabId, editColumnBindings } = props
  const isEditMode = Boolean(props.editMode)
  const gridRef = useRef<GridHandle | null>(null)
  const storeState = useResultGridStoreState(tabId, props.viewRowCount)
  const boundColumnIndexLookup = useMemo(
    () => invertColumnBindings(editColumnBindings),
    [editColumnBindings]
  )
  const { rowSource, rowAt } = useResultRowLookup(props, boundColumnIndexLookup)
  const resultColumns = useResultGridColumns({
    ...props,
    editForeignKeys: props.editForeignKeys ?? EMPTY_FOREIGN_KEYS,
    columnWidths: storeState.columnWidths,
  })
  const { gridColumns } = resultColumns
  const session = useResultSession(props)
  const { editorCallbacksContext, ...editHandlers } = useGridEditHandlers({
    session: session,
    rowAt: rowAt,
    columns: gridColumns,
  })
  const derived = useDerivedGridState(props, {
    boundColumnIndexLookup: boundColumnIndexLookup,
    selectedCell: storeState.selectedCell,
  })
  const foreignKeyLookup = useForeignKeyLookup({
    session: session,
    columns: gridColumns,
    isActive: props.isActive ?? true,
    gridFocus: { gridRef: gridRef, selectedCellPosition: derived.selectedCellPosition },
  })
  const blobViewer = useBlobViewer({ session: session, columns: gridColumns })
  const deferredSelection = useDeferredReadOnlySelection(props)
  const sort = useResultGridSort(props)
  const gridProps = buildResultGridProps({
    props: props,
    rowSource: rowSource,
    columns: resultColumns,
    storeState: storeState,
    sort: sort,
    editHandlers: editHandlers,
    derived: derived,
    cellActions: {
      onFkCellAction: foreignKeyLookup.onFkCellAction,
      onCellDoubleClick: blobViewer.openBlobViewer,
      onCellSelectionChange: isEditMode ? undefined : deferredSelection,
    },
  })

  return {
    gridRef: gridRef,
    gridProps: gridProps,
    editorCallbacksContext: editorCallbacksContext,
    foreignKeyLookup: foreignKeyLookup,
    blobViewer: blobViewer,
  }
}
