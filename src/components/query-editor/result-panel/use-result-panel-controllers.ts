import { useCallback, useEffect } from 'react'
import { useQueryStore, getActiveResult, type SingleResultState } from '../../../stores/query-store'
import { useResultFilter, type ResultFilter } from './use-result-filter'
import { useResultViewHandlers, type ResultViewHandlers } from './use-result-view-handlers'

export interface ResultPanelControllers {
  activeResult: SingleResultState
  activeResultIndex: number
  viewHandlers: ResultViewHandlers
  filter: ResultFilter
}

interface InactiveOverlayCloser {
  tabId: string
  isActive: boolean
  exportDialogOpen: boolean
  closeFilterDialog: () => void
}

function useCloseOverlaysWhenInactive(inputs: InactiveOverlayCloser) {
  const { tabId, isActive, exportDialogOpen, closeFilterDialog } = inputs
  const closeExportDialog = useQueryStore((state) => state.closeExportDialog)
  useEffect(() => {
    if (isActive) return
    queueMicrotask(() => {
      if (exportDialogOpen) closeExportDialog(tabId)
      closeFilterDialog()
    })
  }, [closeExportDialog, exportDialogOpen, isActive, tabId, closeFilterDialog])
}

export function useResultPanelControllers(
  tabId: string,
  isActive: boolean
): ResultPanelControllers {
  const activeResult = useQueryStore((state) => getActiveResult(state.tabs[tabId]))
  const activeResultIndex = useQueryStore((state) => state.tabs[tabId]?.activeResultIndex ?? 0)
  const viewHandlers = useResultViewHandlers(tabId, activeResult)
  const filter = useResultFilter({
    tabId: tabId,
    activeResultIndex: activeResultIndex,
    result: activeResult,
  })
  useCloseOverlaysWhenInactive({
    tabId: tabId,
    isActive: isActive,
    exportDialogOpen: activeResult.exportDialogOpen,
    closeFilterDialog: filter.closeFilterDialog,
  })
  return { activeResult, activeResultIndex, viewHandlers, filter }
}

export function useRetryExpiredResult(tabId: string): () => void {
  const retryExpiredResult = useQueryStore((state) => state.retryExpiredResult)
  return useCallback(() => {
    void retryExpiredResult(tabId)
  }, [retryExpiredResult, tabId])
}
