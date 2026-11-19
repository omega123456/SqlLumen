import { useCallback } from 'react'
import { useQueryStore, type SingleResultState } from '../../../stores/query-store'
import { UnsavedChangesDialog } from '../../shared/UnsavedChangesDialog'
import ExportDialog from '../../dialogs/ExportDialog'
import { FilterDialog } from '../../dialogs/FilterDialog'
import type { ResultFilter } from './use-result-filter'
import type { DataViewSurfaceRef } from '../../../stores/data-view/data-view-types'

interface ResultPanelDialogsProps {
  surfaceRef: DataViewSurfaceRef
  connectionId: string
  result: SingleResultState
  filter: ResultFilter
}

function PendingNavigationDialog({
  surfaceRef,
  saveError,
}: {
  surfaceRef: DataViewSurfaceRef
  saveError: string | null
}) {
  const pendingNavigationAction = useQueryStore(
    (state) =>
      state.tabs[surfaceRef.tabId]?.results[surfaceRef.resultIndex]?.view.prompts
        .pendingNavigation ?? null
  )
  const confirmNavigation = useQueryStore((state) => state.confirmNavigation)
  const cancelNavigation = useQueryStore((state) => state.cancelNavigation)

  const handleDialogSave = useCallback(async () => {
    await confirmNavigation(surfaceRef, true)
  }, [confirmNavigation, surfaceRef])

  const handleDialogDiscard = useCallback(() => {
    confirmNavigation(surfaceRef, false)
  }, [confirmNavigation, surfaceRef])

  const handleDialogCancel = useCallback(() => {
    cancelNavigation(surfaceRef)
  }, [cancelNavigation, surfaceRef])

  if (pendingNavigationAction === null) return null
  return (
    <UnsavedChangesDialog
      tabId={surfaceRef.tabId}
      onSave={handleDialogSave}
      onDiscard={handleDialogDiscard}
      onCancel={handleDialogCancel}
      error={saveError}
    />
  )
}

export function ResultPanelDialogs({
  surfaceRef,
  connectionId,
  result,
  filter,
}: ResultPanelDialogsProps) {
  const closeExportDialog = useQueryStore((state) => state.closeExportDialog)
  return (
    <>
      {result.view.prompts.isExportOpen && (
        <ExportDialog
          connectionId={connectionId}
          tabId={surfaceRef.tabId}
          resultIndex={surfaceRef.resultIndex}
          onClose={() => closeExportDialog(surfaceRef)}
        />
      )}

      <FilterDialog
        isOpen={filter.isFilterDialogOpen}
        initialConditions={filter.initialConditions}
        columns={filter.filterColumns}
        onApply={filter.applyFilter}
        onCancel={filter.closeFilterDialog}
      />

      <PendingNavigationDialog surfaceRef={surfaceRef} saveError={result.view.edit.saveError} />
    </>
  )
}
