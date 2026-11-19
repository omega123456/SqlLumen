import { useCallback, useMemo } from 'react'
import { BaseFormView } from '../BaseFormView'
import { FkLookupProvider } from '../fk-lookup-context'
import { isIndexInBounds } from '../../../lib/value-checks'
import type { DataViewSurfaceRef } from '../../../stores/data-view/data-view-types'
import { setSelectedRow } from '../../../stores/data-view/view-actions'
import { currentView, useDataView } from '../../../stores/data-view/use-data-view'
import { BlobViewerTargetDialog } from './BlobViewerTargetDialog'
import { ForeignKeyLookupTargetDialog } from './ForeignKeyLookupTargetDialog'
import { useBlobViewer } from './use-blob-viewer'
import { useForeignKeyLookup } from './use-foreign-key-lookup'
import {
  useFormEditHandlers,
  useFormRecordNavigation,
  type FormNavigationDirection,
} from './use-form-edit-handlers'
import { useDataColumnDescriptors } from './data-column-descriptors'
import { useDataEditSession } from './use-data-edit-session'
import type { DataViewSource } from './data-view-source'
import { editLocationOf, invertColumnBindings, toSharedEditState } from './grid/data-grid-model'
import { buildFormRowData, isEditingFormRow, resolveFormRowPosition } from './form/data-form-model'
import { useFormCurrentRow } from './form/use-form-current-row'

export interface DataFormViewProps {
  source: DataViewSource
}

const NAVIGATION_STEP: Record<FormNavigationDirection, number> = { prev: -1, next: 1 }

function formRowCountOf(ref: DataViewSurfaceRef): number {
  const view = currentView(ref)
  return view.slot.viewRowCount + (view.edit.draftRow ? 1 : 0)
}

function navigateForm(ref: DataViewSurfaceRef, direction: FormNavigationDirection) {
  const currentIndex = currentView(ref).selection.rowIndex ?? 0
  const nextIndex = currentIndex + NAVIGATION_STEP[direction]
  if (!isIndexInBounds(nextIndex, formRowCountOf(ref))) return
  setSelectedRow(ref, nextIndex)
}

function useFormView(ref: DataViewSurfaceRef) {
  return {
    slot: useDataView(ref, (view) => view.slot),
    edit: useDataView(ref, (view) => view.edit),
    editTarget: useDataView(ref, (view) => view.editTarget),
    selectedRowIndex: useDataView(ref, (view) => view.selection.rowIndex),
  }
}

type FormView = ReturnType<typeof useFormView>

function useCurrentRowData(ref: DataViewSurfaceRef, formView: FormView) {
  const { slot, edit, editTarget, selectedRowIndex } = formView
  const position = resolveFormRowPosition({
    viewRowCount: slot.viewRowCount,
    draftRow: edit.draftRow,
    selectedRowIndex: selectedRowIndex,
  })
  const currentCached = useFormCurrentRow({
    ref: ref,
    slot: slot,
    draftRow: edit.draftRow,
    position: position,
  })
  const columnCount = slot.columns.length
  const boundColumnIndexLookup = useMemo(
    () => invertColumnBindings(editTarget.bindings),
    [editTarget.bindings]
  )
  const currentRowData = useMemo(
    () =>
      buildFormRowData({
        currentCached: currentCached,
        columnCount: columnCount,
        clampedIndex: position.clampedIndex,
        edit: edit,
        boundColumnIndexLookup: boundColumnIndexLookup,
      }),
    [boundColumnIndexLookup, columnCount, currentCached, edit, position.clampedIndex]
  )
  const sharedEditState = useMemo(() => {
    if (!isEditingFormRow(edit, position.clampedIndex)) return null
    return toSharedEditState(edit.state, boundColumnIndexLookup)
  }, [boundColumnIndexLookup, edit, position.clampedIndex])
  return { position, currentCached, currentRowData, sharedEditState }
}

interface FormInteractionInputs {
  source: DataViewSource
  formView: FormView
  currentRowData: Record<string, unknown> | null
}

function useFormInteractions({ source, formView, currentRowData }: FormInteractionInputs) {
  const ref = source.ref
  const { slot, editTarget } = formView
  const gridColumns = useDataColumnDescriptors({
    columns: slot.columns,
    editTarget: editTarget,
  }).descriptors
  const session = useDataEditSession(ref)
  const editHandlers = useFormEditHandlers({
    session: session,
    currentRowData: currentRowData,
    columns: gridColumns,
  })
  const navigate = useCallback(
    (direction: FormNavigationDirection) => navigateForm(ref, direction),
    [ref]
  )
  const navigation = useFormRecordNavigation(session, navigate)
  const foreignKeyLookup = useForeignKeyLookup({
    session: session,
    columns: gridColumns,
    isActive: source.isActive,
    gridFocus: null,
  })
  const blobViewer = useBlobViewer({ session: session, columns: gridColumns })
  const editLocation = useMemo(
    () => editLocationOf(slot.connectionId, editTarget),
    [slot.connectionId, editTarget]
  )
  return { gridColumns, editHandlers, navigation, foreignKeyLookup, blobViewer, editLocation }
}

export function DataFormView({ source }: DataFormViewProps) {
  const ref = source.ref
  const formView = useFormView(ref)
  const isInEditMode = formView.editTarget.tableName !== null
  const { position, currentCached, currentRowData, sharedEditState } = useCurrentRowData(
    ref,
    formView
  )
  const { totalRows, currentIndex } = position
  const { gridColumns, editHandlers, navigation, foreignKeyLookup, blobViewer, editLocation } =
    useFormInteractions({ source: source, formView: formView, currentRowData: currentRowData })

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
        testId={source.testIds.form}
        workspaceTabId={ref.tabId}
        onBlobView={blobViewer.openFormFieldBlob}
      />
      <ForeignKeyLookupTargetDialog lookup={foreignKeyLookup} location={editLocation} />
      <BlobViewerTargetDialog viewer={blobViewer} />
    </FkLookupProvider>
  )
}
