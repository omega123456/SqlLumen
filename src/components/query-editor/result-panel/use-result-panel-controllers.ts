import { useCallback, useEffect, useMemo } from 'react'
import {
  useQueryStore,
  activeResultIndexOf,
  getActiveResult,
  querySurfaceRef,
  type SingleResultState,
} from '../../../stores/query-store'
import type { DataViewSurfaceRef } from '../../../stores/data-view/data-view-types'
import type { DataViewSource } from '../../shared/data-view/data-view-source'
import { queryDataViewSource } from './query-data-view-source'

export interface ResultPanelControllers {
  activeResult: SingleResultState
  activeResultIndex: number
  surfaceRef: DataViewSurfaceRef
  source: DataViewSource
}

interface InactiveExportCloser {
  surfaceRef: DataViewSurfaceRef
  isActive: boolean
  exportDialogOpen: boolean
}

function useCloseExportWhenInactive({
  surfaceRef,
  isActive,
  exportDialogOpen,
}: InactiveExportCloser) {
  const closeExportDialog = useQueryStore((state) => state.closeExportDialog)
  useEffect(() => {
    const isOpenWhileInactive = exportDialogOpen && !isActive
    if (!isOpenWhileInactive) return
    queueMicrotask(() => closeExportDialog(surfaceRef))
  }, [closeExportDialog, exportDialogOpen, isActive, surfaceRef])
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
  useCloseExportWhenInactive({
    surfaceRef: surfaceRef,
    isActive: isActive,
    exportDialogOpen: activeResult.view.prompts.isExportOpen,
  })
  return { activeResult, activeResultIndex, surfaceRef, source }
}

export function useRetryExpiredResult(tabId: string): () => void {
  const retryExpiredResult = useQueryStore((state) => state.retryExpiredResult)
  return useCallback(() => {
    void retryExpiredResult(tabId)
  }, [retryExpiredResult, tabId])
}
