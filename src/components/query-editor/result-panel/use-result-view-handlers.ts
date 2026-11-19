import { useCallback, useMemo } from 'react'
import { useQueryStore, type SingleResultState } from '../../../stores/query-store'
import type { DataViewSurfaceRef } from '../../../stores/data-view/data-view-types'
import type { GridRowActions } from '../../shared/glide/CanvasBaseGridView'
import type { CachedRow } from '../../../lib/result-window-cache'
import { isIndexInBounds } from '../../../lib/value-checks'

export interface ResultViewHandlers {
  handleSortChanged: (column: string, direction: 'asc' | 'desc' | null) => void
  handleRowSelected: (rowIndex: number) => void
  handleFormNavigate: (direction: 'prev' | 'next') => void
  handleStartEditing: (rowIndex: number, row?: CachedRow) => void
  gridRowActions: GridRowActions
  handleUpdateCellValue: (columnIndex: number, value: unknown) => void
  handleSyncCellValue: (columnIndex: number, value: unknown) => void
  handleAutoSave: () => Promise<boolean>
  handleFormSave: () => Promise<boolean>
  handleFormDiscard: () => void
}

function useResultNavigationHandlers(surfaceRef: DataViewSurfaceRef, result: SingleResultState) {
  const requestNavigationAction = useQueryStore((state) => state.requestNavigationAction)
  const sortResults = useQueryStore((state) => state.sortResults)
  const setSelectedRow = useQueryStore((state) => state.setSelectedRow)
  const selectedRowIndex = result.view.selection.rowIndex
  const formRowCount = result.view.slot.viewRowCount + (result.view.edit.draftRow ? 1 : 0)

  const handleSortChanged = useCallback(
    (column: string, direction: 'asc' | 'desc' | null) => {
      requestNavigationAction(surfaceRef, () => {
        sortResults(surfaceRef, { column: column, direction: direction })
      })
    },
    [requestNavigationAction, sortResults, surfaceRef]
  )

  const handleRowSelected = useCallback(
    (rowIndex: number) => {
      setSelectedRow(surfaceRef, rowIndex)
    },
    [setSelectedRow, surfaceRef]
  )

  const handleFormNavigate = useCallback(
    (direction: 'prev' | 'next') => {
      const currentIndex = selectedRowIndex ?? 0
      const newIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1
      if (!isIndexInBounds(newIndex, formRowCount)) return
      setSelectedRow(surfaceRef, newIndex)
    },
    [setSelectedRow, surfaceRef, selectedRowIndex, formRowCount]
  )

  return { handleSortChanged, handleRowSelected, handleFormNavigate }
}

function useGridRowActions(surfaceRef: DataViewSurfaceRef): GridRowActions {
  const beginRowAction = useQueryStore((state) => state.beginRowAction)
  const markResultsExpired = useQueryStore((state) => state.markResultsExpired)
  return useMemo<GridRowActions>(
    () => ({
      begin: (verb, total, onCancel) =>
        beginRowAction(surfaceRef, { verb: verb, total: total, onCancel: onCancel }),
      onExpired: () => markResultsExpired(surfaceRef.tabId),
    }),
    [beginRowAction, markResultsExpired, surfaceRef]
  )
}

function useResultCellEditHandlers(surfaceRef: DataViewSurfaceRef) {
  const startEditingRow = useQueryStore((state) => state.startEditingRow)
  const updateCellValue = useQueryStore((state) => state.updateCellValue)
  const syncCellValue = useQueryStore((state) => state.syncCellValue)

  const handleStartEditing = useCallback(
    (rowIndex: number, row?: CachedRow) => {
      startEditingRow(surfaceRef, rowIndex, row)
    },
    [startEditingRow, surfaceRef]
  )

  const handleUpdateCellValue = useCallback(
    (columnIndex: number, value: unknown) => {
      updateCellValue(surfaceRef, columnIndex, value)
    },
    [updateCellValue, surfaceRef]
  )

  const handleSyncCellValue = useCallback(
    (columnIndex: number, value: unknown) => {
      syncCellValue(surfaceRef, columnIndex, value)
    },
    [syncCellValue, surfaceRef]
  )

  return { handleStartEditing, handleUpdateCellValue, handleSyncCellValue }
}

function useResultRowSaveHandlers(surfaceRef: DataViewSurfaceRef) {
  const saveCurrentRow = useQueryStore((state) => state.saveCurrentRow)
  const discardCurrentRow = useQueryStore((state) => state.discardCurrentRow)

  const handleAutoSave = useCallback(async (): Promise<boolean> => {
    return await saveCurrentRow(surfaceRef)
  }, [saveCurrentRow, surfaceRef])

  const handleFormSave = useCallback(async (): Promise<boolean> => {
    await saveCurrentRow(surfaceRef)
    const tab = useQueryStore.getState().tabs[surfaceRef.tabId]
    const result = tab?.results[surfaceRef.resultIndex]
    return !result?.view.edit.saveError
  }, [saveCurrentRow, surfaceRef])

  const handleFormDiscard = useCallback(() => {
    discardCurrentRow(surfaceRef)
  }, [discardCurrentRow, surfaceRef])

  return { handleAutoSave, handleFormSave, handleFormDiscard }
}

export function useResultViewHandlers(
  surfaceRef: DataViewSurfaceRef,
  result: SingleResultState
): ResultViewHandlers {
  return {
    ...useResultNavigationHandlers(surfaceRef, result),
    ...useResultCellEditHandlers(surfaceRef),
    ...useResultRowSaveHandlers(surfaceRef),
    gridRowActions: useGridRowActions(surfaceRef),
  }
}
