import type { SingleResultState } from '../../../stores/query-store'
import type { TableDataColumnMeta } from '../../../types/schema'
import { ResultGridView } from '../ResultGridView'
import { ResultFormView } from '../ResultFormView'
import { ResultTextView } from '../ResultTextView'
import type { ResultViewHandlers } from './use-result-view-handlers'

export interface ResultViewsProps {
  tabId: string
  activeResultIndex: number
  result: SingleResultState
  editTableColumns: TableDataColumnMeta[]
  handlers: ResultViewHandlers
  isActive: boolean
}

function GridResultView({
  tabId,
  activeResultIndex,
  result,
  editTableColumns,
  handlers,
  isActive,
}: ResultViewsProps) {
  const remountPerResultKey = activeResultIndex
  return (
    <ResultGridView
      key={remountPerResultKey}
      columns={result.columns}
      resultIndex={activeResultIndex}
      queryId={result.queryId}
      viewRowCount={result.viewRowCount}
      viewVersion={result.viewVersion}
      draftRow={result.draftRow}
      sortColumn={result.sortColumn}
      sortDirection={result.sortDirection}
      onSortChanged={handlers.handleSortChanged}
      onRowSelected={handlers.handleRowSelected}
      selectedRowIndex={result.selectedRowIndex}
      tabId={tabId}
      editMode={result.editMode}
      editableColumnMap={result.editableColumnMap}
      editColumnBindings={result.editColumnBindings}
      editState={result.editState}
      editingRowIndex={result.editingRowIndex}
      editingBaseIndex={result.editingBaseIndex}
      editTableColumns={editTableColumns}
      editForeignKeys={result.editForeignKeys}
      onStartEditing={handlers.handleStartEditing}
      onUpdateCellValue={handlers.handleUpdateCellValue}
      onSyncCellValue={handlers.handleSyncCellValue}
      onAutoSave={handlers.handleAutoSave}
      rowActions={handlers.gridRowActions}
      isActive={isActive}
    />
  )
}

function FormResultView({
  tabId,
  activeResultIndex,
  result,
  editTableColumns,
  handlers,
}: ResultViewsProps) {
  return (
    <ResultFormView
      columns={result.columns}
      resultIndex={activeResultIndex}
      queryId={result.queryId}
      viewVersion={result.viewVersion}
      viewRowCount={result.viewRowCount}
      draftRow={result.draftRow}
      selectedRowIndex={result.selectedRowIndex}
      onNavigate={handlers.handleFormNavigate}
      tabId={tabId}
      editMode={result.editMode}
      editableColumnMap={result.editableColumnMap}
      editColumnBindings={result.editColumnBindings}
      editState={result.editState}
      editingRowIndex={result.editingRowIndex}
      editTableColumns={editTableColumns}
      editForeignKeys={result.editForeignKeys}
      onStartEdit={handlers.handleStartEditing}
      onUpdateCell={handlers.handleUpdateCellValue}
      onSaveRow={handlers.handleFormSave}
      onDiscardRow={handlers.handleFormDiscard}
    />
  )
}

function TextResultView({ tabId, activeResultIndex, result }: ResultViewsProps) {
  return (
    <ResultTextView
      columns={result.columns}
      tabId={tabId}
      resultIndex={activeResultIndex}
      queryId={result.queryId}
      viewVersion={result.viewVersion}
      viewRowCount={result.viewRowCount}
      truncated={result.truncated}
      isFiltered={result.filterModel.length > 0}
    />
  )
}

const RESULT_VIEWS_BY_MODE: Record<SingleResultState['viewMode'], typeof GridResultView> = {
  grid: GridResultView,
  form: FormResultView,
  text: TextResultView,
}

export function ResultViews(props: ResultViewsProps) {
  const ViewForMode = RESULT_VIEWS_BY_MODE[props.result.viewMode]
  return <ViewForMode {...props} />
}
