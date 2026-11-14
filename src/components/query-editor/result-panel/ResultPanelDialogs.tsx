import { useCallback } from 'react'
import { useQueryStore, type SingleResultState } from '../../../stores/query-store'
import { FkLookupDialog } from '../../table-data/FkLookupDialog'
import { UnsavedChangesDialog } from '../../shared/UnsavedChangesDialog'
import ExportDialog from '../../dialogs/ExportDialog'
import { FilterDialog } from '../../dialogs/FilterDialog'
import { readEditTable, resolveForeignKeyLookupTarget } from './result-panel-model'
import type { ResultFilter } from './use-result-filter'
import type { ResultForeignKeyLookup } from './use-result-foreign-key-lookup'

interface ResultPanelDialogsProps {
  tabId: string
  connectionId: string
  activeResultIndex: number
  result: SingleResultState
  filter: ResultFilter
  foreignKeyLookup: ResultForeignKeyLookup
}

function PendingNavigationDialog({
  tabId,
  saveError,
}: {
  tabId: string
  saveError: string | null
}) {
  const pendingNavigationAction = useQueryStore(
    (state) => state.tabs[tabId]?.pendingNavigationAction ?? null
  )
  const confirmNavigation = useQueryStore((state) => state.confirmNavigation)
  const cancelNavigation = useQueryStore((state) => state.cancelNavigation)

  const handleDialogSave = useCallback(async () => {
    await confirmNavigation(tabId, true)
  }, [confirmNavigation, tabId])

  const handleDialogDiscard = useCallback(() => {
    confirmNavigation(tabId, false)
  }, [confirmNavigation, tabId])

  const handleDialogCancel = useCallback(() => {
    cancelNavigation(tabId)
  }, [cancelNavigation, tabId])

  if (pendingNavigationAction === null) return null
  return (
    <UnsavedChangesDialog
      tabId={tabId}
      onSave={handleDialogSave}
      onDiscard={handleDialogDiscard}
      onCancel={handleDialogCancel}
      error={saveError}
    />
  )
}

interface ResultForeignKeyLookupDialogProps {
  connectionId: string
  result: SingleResultState
  foreignKeyLookup: ResultForeignKeyLookup
}

function ResultForeignKeyLookupDialog({
  connectionId,
  result,
  foreignKeyLookup,
}: ResultForeignKeyLookupDialogProps) {
  const target = resolveForeignKeyLookupTarget({
    context: foreignKeyLookup.context,
    editMode: result.editMode,
    editTable: readEditTable(result).editTable,
  })
  if (!target) return null
  return (
    <FkLookupDialog
      isOpen={true}
      onClose={foreignKeyLookup.closeLookup}
      onApply={foreignKeyLookup.applyLookup}
      connectionId={connectionId}
      database={target.database}
      sourceTable={target.sourceTable}
      sourceColumn={target.context.sourceColumn}
      currentValue={target.context.currentValue}
      referencedTable={target.context.foreignKey.referencedTable}
      referencedColumn={target.context.foreignKey.referencedColumn}
      isReadOnly={false}
    />
  )
}

export function ResultPanelDialogs({
  tabId,
  connectionId,
  activeResultIndex,
  result,
  filter,
  foreignKeyLookup,
}: ResultPanelDialogsProps) {
  const closeExportDialog = useQueryStore((state) => state.closeExportDialog)
  return (
    <>
      {result.exportDialogOpen && (
        <ExportDialog
          connectionId={connectionId}
          tabId={tabId}
          resultIndex={activeResultIndex}
          onClose={() => closeExportDialog(tabId)}
        />
      )}

      <FilterDialog
        isOpen={filter.isFilterDialogOpen}
        initialConditions={filter.initialConditions}
        columns={filter.filterColumns}
        onApply={filter.applyFilter}
        onCancel={filter.closeFilterDialog}
      />

      <PendingNavigationDialog tabId={tabId} saveError={result.saveError} />

      <ResultForeignKeyLookupDialog
        connectionId={connectionId}
        result={result}
        foreignKeyLookup={foreignKeyLookup}
      />
    </>
  )
}
