import { useCallback } from 'react'
import { useQueryStore, type SingleResultState } from '../../../stores/query-store'
import { UnsavedChangesDialog } from '../../shared/UnsavedChangesDialog'
import ExportDialog from '../../dialogs/ExportDialog'
import { FilterDialog } from '../../dialogs/FilterDialog'
import type { ResultFilter } from './use-result-filter'

interface ResultPanelDialogsProps {
  tabId: string
  connectionId: string
  activeResultIndex: number
  result: SingleResultState
  filter: ResultFilter
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

export function ResultPanelDialogs({
  tabId,
  connectionId,
  activeResultIndex,
  result,
  filter,
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
    </>
  )
}
