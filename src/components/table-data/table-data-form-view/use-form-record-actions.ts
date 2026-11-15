import { useCallback } from 'react'
import { useTableDataStore } from '../../../stores/table-data-store'
import { isAtFirstRecord, navigateToRelativeRow, type FormTabView } from './form-view-model'
import type { FormCurrentRecord } from './use-form-current-record'
import type { FormNavigationDirection } from '../../shared/data-view/use-form-edit-handlers'

export interface FormRecordInputs {
  tabId: string
  view: FormTabView
  record: FormCurrentRecord
  hasTabState: boolean
}

const ROW_STEP_BY_DIRECTION: Record<FormNavigationDirection, -1 | 1> = {
  prev: -1,
  next: 1,
}

export function useTableFormNavigate({ tabId, view, record, hasTabState }: FormRecordInputs) {
  const { isLoading, rows, currentPage, pageSize, primaryKeyColumns } = view
  const { localIndex } = record
  const requestNavigationAction = useTableDataStore((state) => state.requestNavigationAction)
  const fetchPage = useTableDataStore((state) => state.fetchPage)
  return useCallback(
    (navigationDirection: FormNavigationDirection) => {
      const direction = ROW_STEP_BY_DIRECTION[navigationDirection]
      if (!hasTabState) return
      if (isLoading) return
      const isBackwardFromFirstRecord = direction < 0 && isAtFirstRecord(currentPage, localIndex)
      if (isBackwardFromFirstRecord) return
      const position = {
        localIndex: localIndex,
        rowCount: rows.length,
        currentPage: currentPage,
        pageSize: pageSize,
      }
      requestNavigationAction(tabId, () =>
        navigateToRelativeRow({
          tabId: tabId,
          direction: direction,
          position: position,
          primaryKeyColumns: primaryKeyColumns,
          fetchPage: fetchPage,
        })
      )
    },
    [
      hasTabState,
      isLoading,
      localIndex,
      rows.length,
      currentPage,
      pageSize,
      tabId,
      fetchPage,
      primaryKeyColumns,
      requestNavigationAction,
    ]
  )
}
