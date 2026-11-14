import { useMemo } from 'react'
import { BaseFormView } from '../shared/BaseFormView'
import { QueryResultBlobDialog } from './QueryResultBlobDialog'
import { resolveQueryResultColumns } from '../../lib/query-result-column-utils'
import type {
  GridColumnDescriptor,
  RowEditState as SharedRowEditState,
} from '../../types/shared-data-view'
import {
  buildFormRowData,
  resolveFormEditProps,
  resolveFormRowPosition,
  toGridColumnDescriptor,
  toSharedEditState,
  type FormEditProps,
  type ResultFormViewProps,
} from './result-form-view/result-form-model'
import { useFormCurrentRow } from './result-form-view/use-form-current-row'
import { useResultFormHandlers } from './result-form-view/use-result-form-handlers'

export type { ResultFormViewProps } from './result-form-view/result-form-model'

function useFormGridColumns(props: ResultFormViewProps, edit: FormEditProps) {
  const { columns } = props
  const { editMode, editableColumnMap, editTableColumns, editForeignKeys, editColumnBindings } =
    edit
  return useMemo<GridColumnDescriptor[]>(() => {
    const resolvedColumns = resolveQueryResultColumns({
      resultColumns: columns,
      editMode: editMode,
      editableColumnMap: editableColumnMap,
      editTableColumns: editTableColumns,
      editForeignKeys: editForeignKeys,
      editColumnBindings: editColumnBindings,
    })
    const context = { isEditing: editMode !== null, editColumnBindings: editColumnBindings }
    return resolvedColumns.map((column, columnIndex) =>
      toGridColumnDescriptor(column, columnIndex, context)
    )
  }, [columns, editMode, editableColumnMap, editTableColumns, editForeignKeys, editColumnBindings])
}

export function ResultFormView(props: ResultFormViewProps) {
  const { columns } = props
  const edit = resolveFormEditProps(props)
  const { editMode, editState, editingRowIndex, editColumnBindings } = edit
  const position = resolveFormRowPosition(props)
  const { totalRows, currentIndex, clampedIndex } = position
  const currentCached = useFormCurrentRow(props, position)
  const currentRowData = useMemo(
    () =>
      buildFormRowData({
        currentCached: currentCached,
        columnCount: columns.length,
        clampedIndex: clampedIndex,
        rowEdit: {
          editState: editState,
          editingRowIndex: editingRowIndex,
          editColumnBindings: editColumnBindings,
        },
      }),
    [columns, currentCached, editState, editingRowIndex, clampedIndex, editColumnBindings]
  )
  const isInEditMode = editMode !== null
  const isEditingCurrentRow = editState !== null && editingRowIndex === clampedIndex
  const gridColumns = useFormGridColumns(props, edit)
  const sharedEditState: SharedRowEditState | null = useMemo(() => {
    if (!isEditingCurrentRow) return null
    if (!editState) return null
    return toSharedEditState(editState, columns.length, editColumnBindings)
  }, [isEditingCurrentRow, editState, columns, editColumnBindings])
  const { editHandlers, blobViewer, navigation } = useResultFormHandlers(
    { columns, isInEditMode, editState, editingRowIndex, clampedIndex, currentCached },
    props
  )

  return (
    <>
      <BaseFormView
        columns={gridColumns}
        currentRow={currentCached?.row ?? null}
        currentRowData={currentRowData}
        totalRows={totalRows}
        currentAbsoluteIndex={currentIndex}
        isFirstRecord={currentIndex <= 0}
        isLastRecord={currentIndex >= totalRows - 1}
        onNavigatePrev={navigation.handleNavigatePrevious}
        onNavigateNext={navigation.handleNavigateNext}
        editState={sharedEditState}
        {...editHandlers}
        readOnly={!isInEditMode}
        testId="result-form-view"
        onBlobView={blobViewer.handleBlobView}
      />
      <QueryResultBlobDialog
        blobContext={blobViewer.blobContext}
        onClose={blobViewer.closeBlobDialog}
        onApply={blobViewer.handleBlobApply}
      />
    </>
  )
}
