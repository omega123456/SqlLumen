import type { PageRequest } from '../../../../stores/data-view/data-view-types'
import type {
  KnownTotalBaseFormViewProps,
  UnknownTotalBaseFormViewProps,
} from '../../../../types/shared-data-view'
import type { FormNavigationDirection } from '../use-form-edit-handlers'
import type { DataViewPaging } from '../data-view-source'
import type { FormRowPosition } from './data-form-model'

const FIRST_PAGE = 1

export interface FormPageEdge {
  paging: DataViewPaging
  currentIndex: number
  rowCount: number
}

type PageEdgeRequest = (edge: FormPageEdge) => PageRequest | null

function nextPageRequest({ paging, currentIndex, rowCount }: FormPageEdge): PageRequest | null {
  const isAtLastRow = currentIndex >= rowCount - 1
  if (!isAtLastRow) return null
  if (!paging.hasNextPage) return null
  return { page: paging.currentPage + 1, select: 'first' }
}

function previousPageRequest({ paging, currentIndex }: FormPageEdge): PageRequest | null {
  const isAtFirstRow = currentIndex <= 0
  if (!isAtFirstRow) return null
  if (paging.currentPage <= FIRST_PAGE) return null
  return { page: paging.currentPage - 1, select: 'last' }
}

const PAGE_EDGE_REQUESTS: Record<FormNavigationDirection, PageEdgeRequest> = {
  next: nextPageRequest,
  prev: previousPageRequest,
}

export function formPageEdgeRequest(
  direction: FormNavigationDirection,
  edge: FormPageEdge
): PageRequest | null {
  return PAGE_EDGE_REQUESTS[direction](edge)
}

type FormRecordCounter =
  | Pick<
      KnownTotalBaseFormViewProps,
      'recordCountMode' | 'totalRows' | 'isLastRecord' | 'currentAbsoluteIndex' | 'isFirstRecord'
    >
  | Pick<
      UnknownTotalBaseFormViewProps,
      'recordCountMode' | 'totalRows' | 'currentAbsoluteIndex' | 'isFirstRecord'
    >

export interface FormRecordCounterInputs {
  paging: DataViewPaging | null
  position: FormRowPosition
  isLoading: boolean
}

function pagedRecordCounter(
  paging: DataViewPaging,
  { position, isLoading }: FormRecordCounterInputs
): FormRecordCounter {
  const isFirstPageRow = paging.currentPage === FIRST_PAGE && position.currentIndex <= 0
  return {
    recordCountMode: 'unknown',
    totalRows: position.totalRows,
    currentAbsoluteIndex: (paging.currentPage - 1) * paging.pageSize + position.currentIndex,
    isFirstRecord: isFirstPageRow || isLoading,
  }
}

export function formRecordCounterOf(inputs: FormRecordCounterInputs): FormRecordCounter {
  const { paging, position } = inputs
  if (paging) return pagedRecordCounter(paging, inputs)
  return {
    recordCountMode: 'known',
    totalRows: position.totalRows,
    currentAbsoluteIndex: position.currentIndex,
    isFirstRecord: position.currentIndex <= 0,
    isLastRecord: position.currentIndex >= position.totalRows - 1,
  }
}
