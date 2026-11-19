import { useCallback, useEffect, useMemo } from 'react'
import {
  useQueryStore,
  activeResultIndexOf,
  getActiveResult,
  querySurfaceRef,
  type SingleResultState,
} from '../../../stores/query-store'
import type { DataViewSurfaceRef } from '../../../stores/data-view/data-view-types'
import { useResultFilter, type ResultFilter } from './use-result-filter'
import { useResultViewHandlers, type ResultViewHandlers } from './use-result-view-handlers'

export interface ResultPanelControllers {
  activeResult: SingleResultState
  activeResultIndex: number
  surfaceRef: DataViewSurfaceRef
  viewHandlers: ResultViewHandlers
  filter: ResultFilter
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
  const viewHandlers = useResultViewHandlers(surfaceRef, activeResult)
  const filter = useResultFilter({ surfaceRef: surfaceRef, result: activeResult })
  useCloseOverlaysWhenInactive({
    surfaceRef: surfaceRef,
    isActive: isActive,
    exportDialogOpen: activeResult.view.prompts.isExportOpen,
    closeFilterDialog: filter.closeFilterDialog,
  })
  return { activeResult, activeResultIndex, surfaceRef, viewHandlers, filter }
}

export function useRetryExpiredResult(tabId: string): () => void {
  const retryExpiredResult = useQueryStore((state) => state.retryExpiredResult)
  return useCallback(() => {
    void retryExpiredResult(tabId)
  }, [retryExpiredResult, tabId])
}
