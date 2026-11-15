import { useTableDataStore } from '../../stores/table-data-store'
import { useIsConnectionReadOnly } from '../../stores/connection-store'
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
import { useTableEditSession } from './table-data-edit-session'
import {
  canEditFormRows,
  formTabView,
  isAtFirstRecord,
} from './table-data-form-view/form-view-model'
import { useFormCurrentRecord } from './table-data-form-view/use-form-current-record'
import { useTableFormNavigate } from './table-data-form-view/use-form-record-actions'

export interface TableDataFormViewProps {
  tabId: string
  isView?: boolean
  isActive?: boolean
}

const BLOB_VIEW_DISABLED_REASON = 'Cannot view BLOB — table has no primary key'

function useTableFormModel({ tabId, isView, isActive = true }: TableDataFormViewProps) {
  const tabState = useTableDataStore((state) => state.tabs[tabId])
  const view = formTabView(tabState)
  const isConnectionReadOnly = useIsConnectionReadOnly(view.connectionId)
  const isEditable = canEditFormRows({
    isConnectionReadOnly: isConnectionReadOnly,
    hasPrimaryKey: view.primaryKey !== null,
    isView: isView,
  })
  const record = useFormCurrentRecord(view, isEditable)
  const session = useTableEditSession({
    tabId: tabId,
    columns: view.columns,
    primaryKeyColumns: view.primaryKeyColumns,
    descriptorColumns: record.gridColumns,
    canEditRows: isEditable,
  })
  const editHandlers = useFormEditHandlers({
    session: session,
    currentRowData: record.currentRowData,
    columns: record.gridColumns,
  })
  const foreignKeyLookup = useForeignKeyLookup({
    session: session,
    columns: record.gridColumns,
    isActive: isActive,
    gridFocus: null,
  })
  const blobViewer = useBlobViewer({ session: session, columns: record.gridColumns })
  const navigate = useTableFormNavigate({
    tabId: tabId,
    view: view,
    record: record,
    hasTabState: tabState !== undefined,
  })
  const navigation = useFormRecordNavigation(session, navigate)
  return {
    tabState: tabState,
    view: view,
    isEditable: isEditable,
    record: record,
    editHandlers: editHandlers,
    navigation: navigation,
    foreignKeyLookup: foreignKeyLookup,
    blobViewer: blobViewer,
  }
}

export function TableDataFormView(props: TableDataFormViewProps) {
  const { tabId } = props
  const model = useTableFormModel(props)
  const { tabState, view, isEditable, record, editHandlers, navigation } = model
  const { currentPage, pageSize, isLoading } = view
  const hasPrimaryKeyColumns = view.primaryKeyColumns.length > 0
  return (
    <FkLookupProvider onFkLookup={model.foreignKeyLookup.openLookup}>
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
        onEnsureEditing={editHandlers.onEnsureEditing}
        onUpdateCell={editHandlers.onUpdateCell}
        onSave={isEditable ? editHandlers.onSave : undefined}
        onDiscard={isEditable ? editHandlers.onDiscard : undefined}
        readOnly={!isEditable}
        testId="table-data-form-view"
        workspaceTabId={tabId}
        onBlobView={model.blobViewer.openFormFieldBlob}
        blobViewDisabled={!hasPrimaryKeyColumns}
        blobViewDisabledReason={BLOB_VIEW_DISABLED_REASON}
      />
      <ForeignKeyLookupTargetDialog lookup={model.foreignKeyLookup} location={tabState ?? null} />
      <BlobViewerTargetDialog viewer={model.blobViewer} />
    </FkLookupProvider>
  )
}
