import type { DataViewSurfaceRef, PageRequest } from '../../../stores/data-view/data-view-types'
import type { ViewMode } from '../../../types/shared-data-view'
import type { ForeignKeyColumnInfo, TableDataColumnMeta } from '../../../types/schema'

export interface DataViewTestIds {
  grid: string
  form: string
  text: string
  toolbar: string
  restoreOverlay: string
  busyOverlay: string
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

export interface ColumnJumpTarget {
  columnName: string
  nonce: number
}

export interface DataViewColumnJump {
  target: ColumnJumpTarget | null
  highlightedColumn: string | null
  consume: () => void
  clearHighlight: () => void
}

export interface DataColumnMetadata {
  tableColumns: TableDataColumnMeta[]
  foreignKeys: ForeignKeyColumnInfo[]
}

export interface DataViewCapabilities {
  modes: readonly ViewMode[]
  canEdit: boolean
  rowActions: boolean
  blobViewDisabledReason: string | null
  paging: DataViewPaging | null
  reload: DataViewReload | null
  columnJump: DataViewColumnJump | null
  columnMetadata: DataColumnMetadata | null
}

export interface DataViewSource {
  ref: DataViewSurfaceRef
  testIds: DataViewTestIds
  isActive: boolean
  isTruncated: boolean
  capabilities: DataViewCapabilities
}
