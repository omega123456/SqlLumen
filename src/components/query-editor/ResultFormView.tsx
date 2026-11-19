import { useMemo } from 'react'
import { BaseFormView } from '../shared/BaseFormView'
import { FkLookupProvider } from '../shared/fk-lookup-context'
import { BlobViewerTargetDialog } from '../shared/data-view/BlobViewerTargetDialog'
import { ForeignKeyLookupTargetDialog } from '../shared/data-view/ForeignKeyLookupTargetDialog'
import { useBlobViewer } from '../shared/data-view/use-blob-viewer'
import { useForeignKeyLookup } from '../shared/data-view/use-foreign-key-lookup'
import {
  useFormEditHandlers,
  useFormRecordNavigation,
} from '../shared/data-view/use-form-edit-handlers'
import type { RowEditState as SharedRowEditState } from '../../types/shared-data-view'
import { useResultColumnDescriptors } from './result-column-descriptors'
import { useResultEditSession } from './result-edit-session'
import {
  buildFormRowData,
  resolveFormEditProps,
  resolveFormRowPosition,
  toSharedEditState,
  type FormEditProps,
  type ResultFormViewProps,
} from './result-form-view/result-form-model'
import { useFormCurrentRow } from './result-form-view/use-form-current-row'

export type { ResultFormViewProps } from './result-form-view/result-form-model'

const IGNORE_ROW_START = () => {}
const IGNORE_CELL_WRITE = () => {}
const IGNORE_DISCARD = () => {}
const IGNORE_ROW_SELECTION = () => {}
const SAVE_NOTHING = async () => true

function useFormSession(props: ResultFormViewProps, edit: FormEditProps) {
  return useResultEditSession({
    ...edit,
    tabId: props.tabId,
    resultIndex: props.resultIndex,
    queryId: props.queryId,
    viewVersion: props.viewVersion,
    columns: props.columns,
    editingBaseIndex: props.editingBaseIndex ?? null,
    onStartEditing: props.onStartEdit ?? IGNORE_ROW_START,
    onUpdateCellValue: props.onUpdateCell ?? IGNORE_CELL_WRITE,
    onSyncCellValue: props.onSyncCell ?? IGNORE_CELL_WRITE,
    onSaveRow: props.onSaveRow ?? SAVE_NOTHING,
    onDiscardRow: props.onDiscardRow ?? IGNORE_DISCARD,
    onRowSelected: props.onRowSelected ?? IGNORE_ROW_SELECTION,
  })
}

function useCurrentRowData(props: ResultFormViewProps, edit: FormEditProps) {
  const position = resolveFormRowPosition(props)
  const currentCached = useFormCurrentRow(props, position)
  const columnCount = props.columns.length
  const { editState, editingRowIndex, editColumnBindings } = edit
  const currentRowData = useMemo(
    () =>
      buildFormRowData({
        currentCached: currentCached,
        columnCount: columnCount,
        clampedIndex: position.clampedIndex,
        rowEdit: {
          editState: editState,
          editingRowIndex: editingRowIndex,
          editColumnBindings: editColumnBindings,
        },
      }),
    [
      columnCount,
      currentCached,
      editState,
      editingRowIndex,
      position.clampedIndex,
      editColumnBindings,
    ]
  )
  return { position, currentCached, currentRowData }
}

function useSharedEditState(props: ResultFormViewProps, edit: FormEditProps, clampedIndex: number) {
  const { editState, editingRowIndex, editColumnBindings } = edit
  const columnCount = props.columns.length
  const isEditingCurrentRow = editState !== null && editingRowIndex === clampedIndex
  return useMemo<SharedRowEditState | null>(() => {
    if (!isEditingCurrentRow) return null
    if (!editState) return null
    return toSharedEditState(editState, columnCount, editColumnBindings)
  }, [isEditingCurrentRow, editState, columnCount, editColumnBindings])
}

export function ResultFormView(props: ResultFormViewProps) {
  const edit = resolveFormEditProps(props)
  const isInEditMode = edit.editMode !== null
  const { position, currentCached, currentRowData } = useCurrentRowData(props, edit)
  const { totalRows, currentIndex, clampedIndex } = position
  const gridColumns = useResultColumnDescriptors({ ...edit, columns: props.columns }).descriptors
  const sharedEditState = useSharedEditState(props, edit, clampedIndex)
  const session = useFormSession(props, edit)
  const editHandlers = useFormEditHandlers({
    session: session,
    currentRowData: currentRowData,
    columns: gridColumns,
  })
  const navigation = useFormRecordNavigation(session, props.onNavigate)
  const foreignKeyLookup = useForeignKeyLookup({
    session: session,
    columns: gridColumns,
    isActive: props.isActive ?? true,
    gridFocus: null,
  })
  const blobViewer = useBlobViewer({ session: session, columns: gridColumns })

  return (
    <FkLookupProvider onFkLookup={foreignKeyLookup.openLookup}>
      <BaseFormView
        columns={gridColumns}
        currentRow={currentCached?.row ?? null}
        currentRowData={currentRowData}
        totalRows={totalRows}
        currentAbsoluteIndex={currentIndex}
        isFirstRecord={currentIndex <= 0}
        isLastRecord={currentIndex >= totalRows - 1}
        onNavigatePrev={navigation.onNavigatePrevious}
        onNavigateNext={navigation.onNavigateNext}
        editState={sharedEditState}
        onEnsureEditing={isInEditMode ? editHandlers.onEnsureEditing : undefined}
        onUpdateCell={isInEditMode ? editHandlers.onUpdateCell : undefined}
        onSave={isInEditMode ? editHandlers.onSave : undefined}
        onDiscard={isInEditMode ? editHandlers.onDiscard : undefined}
        readOnly={!isInEditMode}
        testId="result-form-view"
        workspaceTabId={props.tabId}
        onBlobView={blobViewer.openFormFieldBlob}
      />
      <ForeignKeyLookupTargetDialog
        lookup={foreignKeyLookup}
        location={props.editLocation ?? null}
      />
      <BlobViewerTargetDialog viewer={blobViewer} />
    </FkLookupProvider>
  )
}
