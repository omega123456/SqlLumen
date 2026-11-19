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
      columns={result.view.slot.columns}
      resultIndex={activeResultIndex}
      queryId={result.view.slot.queryId}
      viewRowCount={result.view.slot.viewRowCount}
      viewVersion={result.view.slot.viewVersion}
      draftRow={result.view.edit.draftRow}
      sortColumn={result.view.spec.sort?.column ?? null}
      sortDirection={result.view.spec.sort?.direction ?? null}
      onSortChanged={handlers.handleSortChanged}
      onRowSelected={handlers.handleRowSelected}
      selectedRowIndex={result.view.selection.rowIndex}
      tabId={tabId}
      surfaceRef={surfaceRef}
      editMode={result.view.editTarget.tableName}
      editableColumnMap={result.view.editTarget.editableColumns}
      editColumnBindings={result.view.editTarget.bindings}
      editState={result.view.edit.state}
      editingRowIndex={result.view.edit.rowIndex}
      editingBaseIndex={result.view.edit.baseIndex}
      editTableColumns={editTableColumns}
      editForeignKeys={result.view.editTarget.foreignKeys}
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
      columns={result.view.slot.columns}
      resultIndex={activeResultIndex}
      queryId={result.view.slot.queryId}
      viewVersion={result.view.slot.viewVersion}
      viewRowCount={result.view.slot.viewRowCount}
      draftRow={result.view.edit.draftRow}
      selectedRowIndex={result.view.selection.rowIndex}
      onNavigate={handlers.handleFormNavigate}
      tabId={tabId}
      editMode={result.view.editTarget.tableName}
      editableColumnMap={result.view.editTarget.editableColumns}
      editColumnBindings={result.view.editTarget.bindings}
      editState={result.view.edit.state}
      editingRowIndex={result.view.edit.rowIndex}
      editingBaseIndex={result.view.edit.baseIndex}
      editTableColumns={editTableColumns}
      editForeignKeys={result.view.editTarget.foreignKeys}
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
      columns={result.view.slot.columns}
      tabId={tabId}
      resultIndex={activeResultIndex}
      queryId={result.view.slot.queryId}
      viewVersion={result.view.slot.viewVersion}
      viewRowCount={result.view.slot.viewRowCount}
      truncated={result.truncated}
      isFiltered={result.view.spec.filters.length > 0}
    />
  )
}

export function ResultViews(props: ResultViewsProps) {
  const remountPerResultKey = props.activeResultIndex
  return (
    <DataViewModeSwitch
      key={remountPerResultKey}
      mode={props.result.view.mode}
      grid={<GridResultView {...props} />}
      form={<FormResultView {...props} />}
      text={<TextResultView {...props} />}
    />
  )
}
