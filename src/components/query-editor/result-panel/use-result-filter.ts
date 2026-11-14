import { useCallback, useMemo, useState } from 'react'
import { useQueryStore, type SingleResultState } from '../../../stores/query-store'
import { useToastStore } from '../../../stores/toast-store'
import type { FilterCondition } from '../../../types/schema'
import { buildInitialConditionsFromCell } from '../../../lib/filter-utils'

interface ResultFilterInputs {
  tabId: string
  activeResultIndex: number
  result: SingleResultState
}

export interface ResultFilter {
  isFilterDialogOpen: boolean
  filterColumns: string[]
  initialConditions: FilterCondition[]
  openFilterDialog: () => void
  closeFilterDialog: () => void
  applyFilter: (conditions: FilterCondition[]) => void
  clearFilter: () => void
}

export function useResultFilter({
  tabId,
  activeResultIndex,
  result,
}: ResultFilterInputs): ResultFilter {
  const applyQueryFilters = useQueryStore((state) => state.applyQueryFilters)
  const showSuccess = useToastStore((state) => state.showSuccess)
  const { columns, filterModel, selectedCell } = result
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
      applyQueryFilters(tabId, activeResultIndex, conditions)
    },
    [tabId, activeResultIndex, applyQueryFilters]
  )

  const clearFilter = useCallback(() => {
    applyQueryFilters(tabId, activeResultIndex, [])
    showSuccess('Filters cleared')
  }, [tabId, activeResultIndex, applyQueryFilters, showSuccess])

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
