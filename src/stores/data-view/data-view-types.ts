import type {
  ColumnMeta,
  FilterCondition,
  ForeignKeyColumnInfo,
  FrontendRowResidencyState,
  QueryTableEditInfo,
  ResultViewSort,
  RowEditState,
  SelectedCellInfo,
} from '../../types/schema'
import type { ViewMode } from '../../types/shared-data-view'
import type { ViewRange } from '../../lib/result-window-cache'

export type DataViewRouteKind = 'query' | 'table'

export interface DataViewSurfaceRef {
  route: DataViewRouteKind
  tabId: string
  resultIndex: number
}

export type PageEdgeSelection = 'first' | 'last'

export interface PageRequest {
  page: number
  select: PageEdgeSelection | null
}

export interface DataViewSlot {
  connectionId: string
  queryId: string | null
  columns: ColumnMeta[]
  viewVersion: number
  viewRowCount: number
  totalRows: number
}

export interface DataViewSelection {
  rowIndex: number | null
  cell: SelectedCellInfo | null
}

export interface DataViewChecked {
  ranges: ViewRange[]
  viewVersion: number
}

export interface DataViewLayout {
  scrollRow: number
  scrollCol: number
  columnWidths: Record<string, number>
}

export type ViewSpecChange = 'sort' | 'filter'

export interface DataViewSpecState {
  sort: ResultViewSort | null
  filters: FilterCondition[]
  applying: ViewSpecChange | null
  error: string | null
}

export interface DataViewWindowStatus {
  pendingRange: ViewRange | null
  failedRange: ViewRange | null
}

export interface DataViewEditSession {
  state: RowEditState | null
  rowIndex: number | null
  baseIndex: number | null
  draftRow: unknown[] | null
  saveError: string | null
  isStale: boolean
}

export interface DataViewEditTarget {
  tableName: string | null
  tables: Record<string, QueryTableEditInfo>
  foreignKeys: ForeignKeyColumnInfo[]
  editableColumns: Map<number, boolean>
  bindings: Map<number, string>
  boundIndexByName: Map<string, number>
}

export interface DataViewResidency {
  rows: FrontendRowResidencyState
  evictedAt: number | null
  isExpired: boolean
}

export type ExportRowScope = 'currentView' | 'allRows'

export interface DataViewPrompts {
  isExportOpen: boolean
  exportScope: ExportRowScope
  pendingNavigation: (() => void) | null
}

export type RowActionVerb = 'Copying' | 'Cutting' | 'Clearing' | 'Pasting' | 'Deleting'

export interface RowActionProgress {
  verb: RowActionVerb
  done: number
  total: number
  cancellable: boolean
  visible: boolean
}

export interface DataViewState {
  mode: ViewMode
  slot: DataViewSlot
  selection: DataViewSelection
  checked: DataViewChecked
  layout: DataViewLayout
  spec: DataViewSpecState
  window: DataViewWindowStatus
  edit: DataViewEditSession
  editTarget: DataViewEditTarget
  residency: DataViewResidency
  prompts: DataViewPrompts
  rowAction: RowActionProgress | null
}

type MergedViewGroup = Exclude<keyof DataViewState, 'mode' | 'rowAction'>

export type DataViewPatch = {
  [Group in MergedViewGroup]?: Partial<DataViewState[Group]>
} & Partial<Pick<DataViewState, 'mode' | 'rowAction'>>
