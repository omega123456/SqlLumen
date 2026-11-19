import { useCallback, type ReactNode } from 'react'
import type { DataViewSurfaceRef } from '../../../../stores/data-view/data-view-types'
import { cancelNavigation, confirmNavigation } from '../../../../stores/data-view/navigation-guard'
import { useDataView } from '../../../../stores/data-view/use-data-view'
import { UnsavedChangesDialog } from '../../UnsavedChangesDialog'
import { FilterDialog } from '../../../dialogs/FilterDialog'
import type { DataViewFilter } from '../toolbar/use-data-filter'

function PendingNavigationDialog({ surfaceRef }: { surfaceRef: DataViewSurfaceRef }) {
  const hasPendingNavigation = useDataView(
    surfaceRef,
    (view) => view.prompts.pendingNavigation !== null
  )
  const saveError = useDataView(surfaceRef, (view) => view.edit.saveError)

  const handleDialogSave = useCallback(async () => {
    await confirmNavigation(surfaceRef, true)
  }, [surfaceRef])

  const handleDialogDiscard = useCallback(() => {
    void confirmNavigation(surfaceRef, false)
  }, [surfaceRef])

  const handleDialogCancel = useCallback(() => {
    cancelNavigation(surfaceRef)
  }, [surfaceRef])

  if (!hasPendingNavigation) return null
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

interface DataViewDialogsProps {
  surfaceRef: DataViewSurfaceRef
  filter: DataViewFilter
  exportDialog: ReactNode
}

export function DataViewDialogs({ surfaceRef, filter, exportDialog }: DataViewDialogsProps) {
  return (
    <>
      {exportDialog}

      <FilterDialog
        isOpen={filter.isFilterDialogOpen}
        initialConditions={filter.initialConditions}
        columns={filter.filterColumns}
        onApply={filter.applyFilter}
        onCancel={filter.closeFilterDialog}
      />

      <PendingNavigationDialog surfaceRef={surfaceRef} />
    </>
  )
}
