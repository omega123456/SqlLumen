import type { SingleResultState } from '../../../stores/query-store'
import type { DataViewSurfaceRef } from '../../../stores/data-view/data-view-types'
import type { TableDataColumnMeta } from '../../../types/schema'
import type { DataViewLocation } from '../../../types/shared-data-view'
import { ResultGridView } from '../ResultGridView'
import { ResultFormView } from '../ResultFormView'
import { ResultTextView } from '../ResultTextView'
import { DataViewModeSwitch } from '../../shared/data-view/DataViewModeSwitch'
import type { ResultViewHandlers } from './use-result-view-handlers'

export interface ResultViewsProps {
  tabId: string
  surfaceRef: DataViewSurfaceRef
  activeResultIndex: number
  result: SingleResultState
  editTableColumns: TableDataColumnMeta[]
  editLocation: DataViewLocation | null
  handlers: ResultViewHandlers
  isActive: boolean
}

function GridResultView({
  tabId,
  surfaceRef,
  activeResultIndex,
  result,
  editTableColumns,
  editLocation,
  handlers,
  isActive,
}: ResultViewsProps) {
  return (
    <ResultGridView
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
      surfaceRef={surfaceRef}
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
      onDiscardRow={handlers.handleFormDiscard}
      editLocation={editLocation}
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
  editLocation,
  handlers,
  isActive,
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
      editingBaseIndex={result.editingBaseIndex}
      editTableColumns={editTableColumns}
      editForeignKeys={result.editForeignKeys}
      onStartEdit={handlers.handleStartEditing}
      onUpdateCell={handlers.handleUpdateCellValue}
      onSyncCell={handlers.handleSyncCellValue}
      onSaveRow={handlers.handleFormSave}
      onDiscardRow={handlers.handleFormDiscard}
      onRowSelected={handlers.handleRowSelected}
      editLocation={editLocation}
      isActive={isActive}
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

export function ResultViews(props: ResultViewsProps) {
  const remountPerResultKey = props.activeResultIndex
  return (
    <DataViewModeSwitch
      key={remountPerResultKey}
      mode={props.result.viewMode}
      grid={<GridResultView {...props} />}
      form={<FormResultView {...props} />}
      text={<TextResultView {...props} />}
    />
  )
}
