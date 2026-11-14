import { useCallback, useMemo } from 'react'
import { useQueryStore, getActiveResult, type SingleResultState } from '../../../stores/query-store'
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

function useResultNavigationHandlers(tabId: string, result: SingleResultState) {
  const requestNavigationAction = useQueryStore((state) => state.requestNavigationAction)
  const sortResults = useQueryStore((state) => state.sortResults)
  const setSelectedRow = useQueryStore((state) => state.setSelectedRow)
  const { selectedRowIndex } = result
  const formRowCount = result.viewRowCount + (result.draftRow ? 1 : 0)

  const handleSortChanged = useCallback(
    (column: string, direction: 'asc' | 'desc' | null) => {
      requestNavigationAction(tabId, () => {
        sortResults(tabId, column, direction)
      })
    },
    [requestNavigationAction, sortResults, tabId]
  )

  const handleRowSelected = useCallback(
    (rowIndex: number) => {
      setSelectedRow(tabId, rowIndex)
    },
    [setSelectedRow, tabId]
  )

  const handleFormNavigate = useCallback(
    (direction: 'prev' | 'next') => {
      const currentIndex = selectedRowIndex ?? 0
      const newIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1
      if (!isIndexInBounds(newIndex, formRowCount)) return
      setSelectedRow(tabId, newIndex)
    },
    [setSelectedRow, tabId, selectedRowIndex, formRowCount]
  )

  return { handleSortChanged, handleRowSelected, handleFormNavigate }
}

function useGridRowActions(tabId: string): GridRowActions {
  const beginRowAction = useQueryStore((state) => state.beginRowAction)
  const markResultsExpired = useQueryStore((state) => state.markResultsExpired)
  return useMemo<GridRowActions>(
    () => ({
      begin: (verb, total, onCancel) =>
        beginRowAction(tabId, { verb: verb, total: total, onCancel: onCancel }),
      onExpired: () => markResultsExpired(tabId),
    }),
    [beginRowAction, markResultsExpired, tabId]
  )
}

function useResultCellEditHandlers(tabId: string) {
  const startEditingRow = useQueryStore((state) => state.startEditingRow)
  const updateCellValue = useQueryStore((state) => state.updateCellValue)
  const syncCellValue = useQueryStore((state) => state.syncCellValue)

  const handleStartEditing = useCallback(
    (rowIndex: number, row?: CachedRow) => {
      startEditingRow(tabId, rowIndex, row)
    },
    [startEditingRow, tabId]
  )

  const handleUpdateCellValue = useCallback(
    (columnIndex: number, value: unknown) => {
      updateCellValue(tabId, columnIndex, value)
    },
    [updateCellValue, tabId]
  )

  const handleSyncCellValue = useCallback(
    (columnIndex: number, value: unknown) => {
      syncCellValue(tabId, columnIndex, value)
    },
    [syncCellValue, tabId]
  )

  return { handleStartEditing, handleUpdateCellValue, handleSyncCellValue }
}

function useResultRowSaveHandlers(tabId: string) {
  const saveCurrentRow = useQueryStore((state) => state.saveCurrentRow)
  const discardCurrentRow = useQueryStore((state) => state.discardCurrentRow)

  const handleAutoSave = useCallback(async (): Promise<boolean> => {
    return await saveCurrentRow(tabId)
  }, [saveCurrentRow, tabId])

  const handleFormSave = useCallback(async (): Promise<boolean> => {
    await saveCurrentRow(tabId)
    const tab = useQueryStore.getState().tabs[tabId]
    const result = getActiveResult(tab)
    return !result.saveError
  }, [saveCurrentRow, tabId])

  const handleFormDiscard = useCallback(() => {
    discardCurrentRow(tabId)
  }, [discardCurrentRow, tabId])

  return { handleAutoSave, handleFormSave, handleFormDiscard }
}

export function useResultViewHandlers(
  tabId: string,
  result: SingleResultState
): ResultViewHandlers {
  return {
    ...useResultNavigationHandlers(tabId, result),
    ...useResultCellEditHandlers(tabId),
    ...useResultRowSaveHandlers(tabId),
    gridRowActions: useGridRowActions(tabId),
  }
}
