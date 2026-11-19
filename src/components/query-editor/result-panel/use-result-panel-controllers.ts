import { useCallback, useEffect, useMemo } from 'react'
import {
  useQueryStore,
  activeResultIndexOf,
  getActiveResult,
  querySurfaceRef,
  type SingleResultState,
} from '../../../stores/query-store'
import type { DataViewSurfaceRef } from '../../../stores/data-view/data-view-types'
import { useDataFilter, type DataViewFilter } from '../../shared/data-view/toolbar/use-data-filter'
import type { DataViewSource } from '../../shared/data-view/data-view-source'
import { queryDataViewSource } from './query-data-view-source'

export interface ResultPanelControllers {
  activeResult: SingleResultState
  activeResultIndex: number
  surfaceRef: DataViewSurfaceRef
  source: DataViewSource
  filter: DataViewFilter
}

interface InactiveOverlayCloser {
  surfaceRef: DataViewSurfaceRef
  isActive: boolean
  exportDialogOpen: boolean
  closeFilterDialog: () => void
}

function useCloseOverlaysWhenInactive(inputs: InactiveOverlayCloser) {
  const { surfaceRef, isActive, exportDialogOpen, closeFilterDialog } = inputs
  const closeExportDialog = useQueryStore((state) => state.closeExportDialog)
  useEffect(() => {
    if (isActive) return
    queueMicrotask(() => {
      if (exportDialogOpen) closeExportDialog(surfaceRef)
      closeFilterDialog()
    })
  }, [closeExportDialog, exportDialogOpen, isActive, surfaceRef, closeFilterDialog])
}

export function useResultPanelControllers(
  tabId: string,
  isActive: boolean
): ResultPanelControllers {
  const activeResult = useQueryStore((state) => getActiveResult(state.tabs[tabId]))
  const activeResultIndex = useQueryStore((state) => activeResultIndexOf(state.tabs[tabId]))
  const surfaceRef = useMemo(
    () => querySurfaceRef(tabId, activeResultIndex),
    [tabId, activeResultIndex]
  )
  const isTruncated = activeResult.truncated
  const canEdit = activeResult.view.editTarget.tableName !== null
  const source = useMemo(
    () =>
      queryDataViewSource({
        ref: surfaceRef,
        isActive: isActive,
        isTruncated: isTruncated,
        canEdit: canEdit,
      }),
    [surfaceRef, isActive, isTruncated, canEdit]
  )
  const filter = useDataFilter(surfaceRef)
  useCloseOverlaysWhenInactive({
    surfaceRef: surfaceRef,
    isActive: isActive,
    exportDialogOpen: activeResult.view.prompts.isExportOpen,
    closeFilterDialog: filter.closeFilterDialog,
  })
  return { activeResult, activeResultIndex, surfaceRef, source, filter }
}

export function useRetryExpiredResult(tabId: string): () => void {
  const retryExpiredResult = useQueryStore((state) => state.retryExpiredResult)
  return useCallback(() => {
    void retryExpiredResult(tabId)
  }, [retryExpiredResult, tabId])
}
