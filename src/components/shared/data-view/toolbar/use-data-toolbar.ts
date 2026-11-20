import { useCallback } from 'react'
import type { DataViewSurfaceRef } from '../../../../stores/data-view/data-view-types'
import { openExportDialog, setViewMode } from '../../../../stores/data-view/view-actions'
import { useDataView } from '../../../../stores/data-view/use-data-view'
import { countRanges } from '../../../../lib/view-ranges'
import type { ViewMode } from '../../../../types/shared-data-view'
import type { DataViewSource } from '../data-view-source'
import {
  isCopySelectedDisabled,
  isRestoringRows,
  rowInsertionOf,
  sortedCheckedRanges,
  type DataToolbarReadiness,
} from './data-toolbar-model'
import { useCopyCheckedRows } from './use-copy-checked-rows'
import { useDataRowActions } from './use-data-row-actions'

function useDataViewActions(ref: DataViewSurfaceRef) {
  return {
    handleViewMode: useCallback((mode: ViewMode) => setViewMode(ref, mode), [ref]),
    handleExport: useCallback(() => openExportDialog(ref), [ref]),
  }
}

export function useDataToolbar(source: DataViewSource, readiness: DataToolbarReadiness) {
  const { ref } = source
  const view = useDataView(ref, (currentView) => currentView)
  const viewActions = useDataViewActions(ref)
  const copyCheckedRows = useCopyCheckedRows(ref)
  const checkedCount = countRanges(sortedCheckedRanges(view))
  const isReloading = source.capabilities.reload?.isLoading ?? false
  const isLoadBusy = isReloading || isRestoringRows(view)
  const isBusy = isLoadBusy || view.rowAction !== null
  const rowActions = useDataRowActions({
    ref: ref,
    view: view,
    checkedCount: checkedCount,
    rowInsertion: rowInsertionOf(view, readiness),
    isBusy: isBusy,
  })
  const hasNoColumns = view.slot.columns.length === 0
  const isEditing = view.edit.state !== null
  const isFilterDisabled = hasNoColumns || isEditing || isBusy
  return {
    view: view,
    viewActions: viewActions,
    rowActions: rowActions,
    isBusy: isBusy,
    isFilterDisabled: isFilterDisabled,
    isCopySelectedDisabled: isCopySelectedDisabled({
      hasData: readiness.hasData,
      checkedCount: checkedCount,
      isRowActionPending: view.rowAction !== null,
    }),
    copyCheckedRows: copyCheckedRows,
  }
}
