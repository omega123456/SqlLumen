import { useCallback, useEffect } from 'react'
import { useQueryStore, getActiveResult, type SingleResultState } from '../../../stores/query-store'
import { useResultFilter, type ResultFilter } from './use-result-filter'
import {
  useResultForeignKeyLookup,
  type ResultForeignKeyLookup,
} from './use-result-foreign-key-lookup'
import { useResultViewHandlers, type ResultViewHandlers } from './use-result-view-handlers'

export interface ResultPanelControllers {
  activeResult: SingleResultState
  activeResultIndex: number
  viewHandlers: ResultViewHandlers
  filter: ResultFilter
  foreignKeyLookup: ResultForeignKeyLookup
}

interface InactiveOverlayCloser {
  tabId: string
  isActive: boolean
  exportDialogOpen: boolean
  closeFilterDialog: () => void
  closeLookup: () => void
}

function useCloseOverlaysWhenInactive(inputs: InactiveOverlayCloser) {
  const { tabId, isActive, exportDialogOpen, closeFilterDialog, closeLookup } = inputs
  const closeExportDialog = useQueryStore((state) => state.closeExportDialog)
  useEffect(() => {
    if (isActive) return
    queueMicrotask(() => {
      if (exportDialogOpen) closeExportDialog(tabId)
      closeFilterDialog()
      closeLookup()
    })
  }, [closeExportDialog, exportDialogOpen, isActive, tabId, closeFilterDialog, closeLookup])
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
  const foreignKeyLookup = useResultForeignKeyLookup({
    tabId: tabId,
    activeResultIndex: activeResultIndex,
    result: activeResult,
    onRowSelected: viewHandlers.handleRowSelected,
  })
  useCloseOverlaysWhenInactive({
    tabId: tabId,
    isActive: isActive,
    exportDialogOpen: activeResult.exportDialogOpen,
    closeFilterDialog: filter.closeFilterDialog,
    closeLookup: foreignKeyLookup.closeLookup,
  })
  return { activeResult, activeResultIndex, viewHandlers, filter, foreignKeyLookup }
}

export function useRetryExpiredResult(tabId: string): () => void {
  const retryExpiredResult = useQueryStore((state) => state.retryExpiredResult)
  return useCallback(() => {
    void retryExpiredResult(tabId)
  }, [retryExpiredResult, tabId])
}
