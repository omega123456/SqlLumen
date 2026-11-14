import { useCallback, useMemo, type ComponentProps } from 'react'
import { columnIndexFromKey } from '../../../lib/col-key-utils'
import { useLatestRef } from '../../../hooks/use-latest-ref'
import type { ResultRow } from '../../../lib/result-row-materializer'
import type { ForeignKeyColumnInfo } from '../../../types/schema'
import type { CanvasBaseGridView } from '../../shared/glide/CanvasBaseGridView'
import {
  READ_ONLY_SELECTED_ROW_CLASS,
  editableColumnKeysOf,
  invertColumnBindings,
  resultRowClass,
  selectedCellPositionOf,
  toSharedEditState,
  type ResultGridViewProps,
} from './result-grid-model'
import { useResultBlobViewer } from './use-result-blob-viewer'
import { useResultGridColumns } from './use-result-grid-columns'
import { useResultGridEditing } from './use-result-grid-editing'
import { useResultGridSort } from './use-result-grid-sort'
import { useResultGridStoreState } from './use-result-grid-store-state'
import { useResultRowSource } from './use-result-row-source'
import { useResultSelectionSync } from './use-result-selection-sync'

type CanvasGridProps = ComponentProps<typeof CanvasBaseGridView>

const EMPTY_FOREIGN_KEYS: ForeignKeyColumnInfo[] = []
const EMPTY_ROWS: ResultRow[] = []

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
  const editableColumnKeys = useMemo(
    () => editableColumnKeysOf(props.editableColumnMap),
    [props.editableColumnMap]
  )
  const selectedCellPosition = useMemo(
    () => selectedCellPositionOf({ columns, selectedCell, selectedRowIndex }),
    [columns, selectedCell, selectedRowIndex]
  )
  const sharedEditState = useMemo(
    () => toSharedEditState(editState, boundColumnIndexLookup),
    [editState, boundColumnIndexLookup]
  )
  const getRowClass = useCallback(
    (row: Record<string, unknown>) =>
      resultRowClass(row, { selectedRowIndex, editingRowIndex, editingBaseIndex }),
    [selectedRowIndex, editingRowIndex, editingBaseIndex]
  )
  return { editableColumnKeys, selectedCellPosition, sharedEditState, getRowClass }
}

function useCellValueHandlers(
  props: ResultGridViewProps,
  autoSave: (row: number) => Promise<boolean>
) {
  const { onSyncCellValue } = props
  const onCellValueChange = useCallback(
    (_rowIndex: number, changedColumnKey: string, newValue: unknown) => {
      const columnIndex = columnIndexFromKey(changedColumnKey)
      if (columnIndex >= 0) onSyncCellValue(columnIndex, newValue)
    },
    [onSyncCellValue]
  )
  const onRowChanging = useCallback(
    async (_fromRowIndex: number, toRowIndex: number) => autoSave(toRowIndex),
    [autoSave]
  )
  return { onCellValueChange, onRowChanging }
}

interface ResultGridParts {
  props: ResultGridViewProps
  rowSource: CanvasGridProps['rowSource']
  columns: ReturnType<typeof useResultGridColumns>
  storeState: ReturnType<typeof useResultGridStoreState>
  selection: ReturnType<typeof useResultSelectionSync>
  blobViewer: ReturnType<typeof useResultBlobViewer>
  sort: ReturnType<typeof useResultGridSort>
  editing: ReturnType<typeof useResultGridEditing>
  derived: ReturnType<typeof useDerivedGridState>
  cellValueHandlers: ReturnType<typeof useCellValueHandlers>
}

function buildResultGridProps(parts: ResultGridParts): CanvasGridProps {
  const { props, storeState, selection, sort, editing, derived } = parts
  const isEditMode = Boolean(props.editMode)
  return {
    rows: EMPTY_ROWS,
    rowSource: parts.rowSource,
    rowActions: props.rowActions,
    columns: parts.columns.gridColumns,
    editState: derived.sharedEditState,
    sortColumn: sort.sortColumnKey,
    sortDirection: sort.sortDirectionUpper,
    onSortChange: sort.handleSortChange,
    onCellClickGuard: isEditMode ? editing.cellClickGuard : editing.readOnlyCellClickGuard,
    onCellSelectionChange: isEditMode ? undefined : selection.handleCellSelectionChange,
    runCellClickGuardOnKeyboardSelection: isEditMode,
    isEditMode: isEditMode,
    selectedRowClassName: isEditMode ? undefined : READ_ONLY_SELECTED_ROW_CLASS,
    showReadOnlyHeaders: isEditMode,
    onCellClipboardEdit: editing.handleCellClipboardEdit,
    onCellDoubleClick: parts.blobViewer.handleCellDoubleClick,
    selectedCellPosition: derived.selectedCellPosition,
    onSelectedCellChange: selection.handleSelectedCellChange,
    editableColumnKeys: derived.editableColumnKeys,
    ...parts.cellValueHandlers,
    rowKeyGetter: rowKeyOf,
    getRowClass: derived.getRowClass,
    selectedRowIndex: props.selectedRowIndex,
    isModifiedCell: editing.isModifiedCell,
    autoSizeConfig: parts.columns.autoSizeConfig,
    isActive: props.isActive ?? true,
    onScrollCellChange: storeState.handleScrollCellChange,
    initialScrollCell: storeState.initialScrollCell,
    rowMarkers: 'checkbox',
    onRowMarkerRangesChange: storeState.handleRowMarkerRangesChange,
    resetSelectionKey: storeState.resetSelectionKey,
    testId: 'result-grid',
  }
}

export function useResultGridViewModel(props: ResultGridViewProps) {
  const { tabId, columns, editColumnBindings } = props
  const storeState = useResultGridStoreState(tabId, props.viewRowCount)
  const boundColumnIndexLookup = useMemo(
    () => invertColumnBindings(editColumnBindings),
    [editColumnBindings]
  )
  const rowSource = useResultRowSource({
    ...props,
    columnCount: columns.length,
    boundColumnIndexLookup: boundColumnIndexLookup,
  })
  const rowSourceRef = useLatestRef(rowSource)
  const selection = useResultSelectionSync({ ...props, rowSourceRef: rowSourceRef })
  const { gridColumns, autoSizeConfig } = useResultGridColumns({
    ...props,
    editForeignKeys: props.editForeignKeys ?? EMPTY_FOREIGN_KEYS,
  })
  const blobViewer = useResultBlobViewer({ ...props, gridColumns: gridColumns })
  const sort = useResultGridSort(props)
  const editing = useResultGridEditing({ ...props, ...selection })
  const derived = useDerivedGridState(props, {
    boundColumnIndexLookup: boundColumnIndexLookup,
    selectedCell: storeState.selectedCell,
  })
  const cellValueHandlers = useCellValueHandlers(props, editing.autoSaveBeforeLeavingEditedRow)
  const gridProps = buildResultGridProps({
    props: props,
    rowSource: rowSource,
    columns: { gridColumns: gridColumns, autoSizeConfig: autoSizeConfig },
    storeState: storeState,
    selection: selection,
    blobViewer: blobViewer,
    sort: sort,
    editing: editing,
    derived: derived,
    cellValueHandlers: cellValueHandlers,
  })

  return {
    gridProps: gridProps,
    editorCallbacksContext: editing.editorCallbacksContext,
    blobViewer: blobViewer,
  }
}
