import { useCallback, useMemo, useState } from 'react'
import { useToastStore } from '../../../../stores/toast-store'
import type { FilterCondition } from '../../../../types/schema'
import { buildInitialConditionsFromCell } from '../../../../lib/filter-utils'
import type { DataViewSurfaceRef } from '../../../../stores/data-view/data-view-types'
import { applyFilters } from '../../../../stores/data-view/view-actions'
import { useDataView } from '../../../../stores/data-view/use-data-view'

export interface DataViewFilter {
  isFilterDialogOpen: boolean
  filterColumns: string[]
  initialConditions: FilterCondition[]
  openFilterDialog: () => void
  closeFilterDialog: () => void
  applyFilter: (conditions: FilterCondition[]) => void
  clearFilter: () => void
}

export function useDataFilter(ref: DataViewSurfaceRef): DataViewFilter {
  const showSuccess = useToastStore((state) => state.showSuccess)
  const columns = useDataView(ref, (view) => view.slot.columns)
  const filterModel = useDataView(ref, (view) => view.spec.filters)
  const selectedCell = useDataView(ref, (view) => view.selection.cell)
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false)
  const filterColumns = useMemo(() => columns.map((column) => column.name), [columns])

  const initialConditions: FilterCondition[] = useMemo(
    () => buildInitialConditionsFromCell(selectedCell, filterModel),
    [filterModel, selectedCell]
  )

  const openFilterDialog = useCallback(() => setIsFilterDialogOpen(true), [])
  const closeFilterDialog = useCallback(() => setIsFilterDialogOpen(false), [])

  const applyFilter = useCallback(
    (conditions: FilterCondition[]) => {
      setIsFilterDialogOpen(false)
      applyFilters(ref, conditions)
    },
    [ref]
  )

  const clearFilter = useCallback(() => {
    applyFilters(ref, [])
    showSuccess('Filters cleared')
  }, [ref, showSuccess])

  return {
    isFilterDialogOpen,
    filterColumns,
    initialConditions,
    openFilterDialog,
    closeFilterDialog,
    applyFilter,
    clearFilter,
  }
}
