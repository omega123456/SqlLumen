import type { DataViewSurfaceRef } from '../../../stores/data-view/data-view-types'
import type { ViewMode } from '../../../types/schema'

export interface DataViewTestIds {
  grid: string
  form: string
  text: string
  toolbar: string
  restoreOverlay: string
  busyOverlay: string
}

export type PageEdgeSelection = 'first' | 'last'

export interface PageRequest {
  page: number
  select: PageEdgeSelection
}

export interface DataViewPaging {
  currentPage: number
  pageSize: number
  hasNextPage: boolean
  goToPage: (request: PageRequest) => void
  setPageSize: (pageSize: number) => void
}

export interface DataViewReload {
  isLoading: boolean
  isCancelling: boolean
  onReload: () => void
  onCancel: () => void
}

export interface DataViewColumnJump {
  columnKey: string | null
  nonce: number
  onConsumed: () => void
}

export interface DataViewCapabilities {
  modes: readonly ViewMode[]
  canEdit: boolean
  paging: DataViewPaging | null
  reload: DataViewReload | null
  columnJump: DataViewColumnJump | null
}

export interface DataViewSource {
  ref: DataViewSurfaceRef
  testIds: DataViewTestIds
  isActive: boolean
  isTruncated: boolean
  capabilities: DataViewCapabilities
}
