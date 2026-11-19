import { useCallback } from 'react'
import type { DataViewSurfaceRef } from '../../../../stores/data-view/data-view-types'
import { requestNavigationAction } from '../../../../stores/data-view/navigation-guard'
import { PaginationGroup } from '../../toolbar/PaginationGroup'
import type { DataViewPaging } from '../data-view-source'

const FIRST_PAGE = 1

interface DataPagingProps {
  surfaceRef: DataViewSurfaceRef
  paging: DataViewPaging
  isBusy: boolean
}

function useGuardedPaging(surfaceRef: DataViewSurfaceRef, paging: DataViewPaging) {
  const { currentPage, goToPage, setPageSize } = paging
  const goToPageGuarded = useCallback(
    (page: number) =>
      requestNavigationAction(surfaceRef, () => goToPage({ page: page, select: null })),
    [surfaceRef, goToPage]
  )
  return {
    onPageSubmit: goToPageGuarded,
    onPrevPage: useCallback(() => {
      if (currentPage <= FIRST_PAGE) return
      goToPageGuarded(currentPage - 1)
    }, [currentPage, goToPageGuarded]),
    onNextPage: useCallback(() => goToPageGuarded(currentPage + 1), [currentPage, goToPageGuarded]),
    onPageSizeChange: useCallback(
      (pageSize: number) => requestNavigationAction(surfaceRef, () => setPageSize(pageSize)),
      [surfaceRef, setPageSize]
    ),
  }
}

export function DataPaging({ surfaceRef, paging, isBusy }: DataPagingProps) {
  const handlers = useGuardedPaging(surfaceRef, paging)
  return (
    <PaginationGroup
      currentPage={paging.currentPage}
      paginationMode="unknown"
      pageSize={paging.pageSize}
      disabled={isBusy}
      {...handlers}
    />
  )
}
