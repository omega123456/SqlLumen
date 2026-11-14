import { useCallback } from 'react'
import { useTableDataStore } from '../../stores/table-data-store'
import { useIsConnectionReadOnly } from '../../stores/connection-store'
import { BaseFormView } from '../shared/BaseFormView'
import { FkLookupProvider } from '../shared/fk-lookup-context'
import { BlobViewerTargetDialog, ForeignKeyLookupTargetDialog } from './TableDataCellDialogs'
import { useBlobViewerState } from './use-blob-viewer-state'
import type { GridColumnDescriptor } from '../../types/shared-data-view'
import {
  canEditFormRows,
  formTabView,
  isAtFirstRecord,
} from './table-data-form-view/form-view-model'
import { useFormCurrentRecord } from './table-data-form-view/use-form-current-record'
import { useFormForeignKeys } from './table-data-form-view/use-form-foreign-keys'
import { useFormEditing, useFormNavigation } from './table-data-form-view/use-form-record-actions'

export interface TableDataFormViewProps {
  tabId: string
  isView?: boolean
  isActive?: boolean
}

const BLOB_VIEW_DISABLED_REASON = 'Cannot view BLOB — table has no primary key'

function useFormBlobViewer(
  tabId: string,
  view: ReturnType<typeof formTabView>,
  isEditable: boolean
) {
  const blobViewer = useBlobViewerState({
    tabId: tabId,
    columns: view.columns,
    primaryKeyColumns: view.primaryKeyColumns,
  })
  const canResolveBlobPrimaryKey = isEditable && view.primaryKeyColumns.length > 0
  const { openBlobViewer } = blobViewer
  const onBlobView = useCallback(
    (column: GridColumnDescriptor, rowData: Record<string, unknown> | null) => {
      if (!rowData) return
      if (!canResolveBlobPrimaryKey) return
      openBlobViewer(column.key, rowData)
    },
    [canResolveBlobPrimaryKey, openBlobViewer]
  )
  return { blobViewer, canResolveBlobPrimaryKey, onBlobView }
}

function useTableFormModel({ tabId, isView, isActive = true }: TableDataFormViewProps) {
  const tabState = useTableDataStore((state) => state.tabs[tabId])
  const view = formTabView(tabState)
  const isConnectionReadOnly = useIsConnectionReadOnly(view.connectionId)
  const isEditable = canEditFormRows({
    isConnectionReadOnly: isConnectionReadOnly,
    hasPrimaryKey: view.primaryKey !== null,
    isView: isView,
  })
  const record = useFormCurrentRecord(view)
  const recordInputs = {
    tabId: tabId,
    view: view,
    record: record,
    isEditable: isEditable,
    hasTabState: tabState !== undefined,
  }
  const editing = useFormEditing(recordInputs)
  const foreignKeys = useFormForeignKeys({
    ...recordInputs,
    isActive: isActive,
    ensureEditingCurrentRow: editing.ensureEditingCurrentRow,
  })
  return {
    tabState: tabState,
    view: view,
    isEditable: isEditable,
    record: record,
    editing: editing,
    navigation: useFormNavigation(recordInputs),
    foreignKeys: foreignKeys,
    blob: useFormBlobViewer(tabId, view, isEditable),
  }
}

export function TableDataFormView(props: TableDataFormViewProps) {
  const { tabId } = props
  const { tabState, view, isEditable, record, editing, navigation, foreignKeys, blob } =
    useTableFormModel(props)
  const { currentPage, pageSize, isLoading } = view
  const { foreignKeyLookupTarget } = foreignKeys
  return (
    <FkLookupProvider onFkLookup={foreignKeys.onForeignKeyLookup}>
      <BaseFormView
        columns={record.gridColumns}
        currentRow={record.currentRow}
        currentRowData={record.currentRowData}
        recordCountMode="unknown"
        currentAbsoluteIndex={(currentPage - 1) * pageSize + record.localIndex}
        isFirstRecord={isAtFirstRecord(currentPage, record.localIndex) || isLoading}
        onNavigatePrev={navigation.onNavigatePrevious}
        onNavigateNext={navigation.onNavigateNext}
        isLoading={isLoading}
        editState={record.sharedEditState}
        onEnsureEditing={editing.onEnsureEditing}
        onUpdateCell={editing.onUpdateCell}
        onSave={isEditable ? editing.onSave : undefined}
        onDiscard={isEditable ? editing.onDiscard : undefined}
        readOnly={!isEditable}
        testId="table-data-form-view"
        workspaceTabId={tabId}
        onBlobView={blob.onBlobView}
        blobViewDisabled={!blob.canResolveBlobPrimaryKey}
        blobViewDisabledReason={BLOB_VIEW_DISABLED_REASON}
      />
      {foreignKeyLookupTarget && tabState && (
        <ForeignKeyLookupTargetDialog
          target={foreignKeyLookupTarget}
          tableLocation={tabState}
          isReadOnly={!isEditable}
          onClose={foreignKeys.closeForeignKeyLookup}
          onApply={foreignKeys.onForeignKeyApply}
        />
      )}
      <BlobViewerTargetDialog viewer={blob.blobViewer} />
    </FkLookupProvider>
  )
}
