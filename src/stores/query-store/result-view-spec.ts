import type {
  ColumnMeta,
  MultiQueryResultItem,
  ResultViewSort,
  ResultViewSpec,
  ResultWindow,
} from '../../types/schema'
import { EMPTY_WINDOW } from './query-state-defaults'
import type { SingleResultState } from './query-state-types'

export function getResultViewSpec(result: SingleResultState): ResultViewSpec {
  return {
    sort:
      result.sortColumn && result.sortDirection
        ? { column: result.sortColumn, direction: result.sortDirection }
        : null,
    filters: result.filterModel,
  }
}

export function rerunViewSpec(result: SingleResultState | undefined): ResultViewSpec | null {
  if (!result) return null
  const spec = getResultViewSpec(result)
  return hasSortOrFilter(spec) ? spec : null
}

function hasSortOrFilter(spec: ResultViewSpec): boolean {
  return spec.sort !== null || spec.filters.length > 0
}

function sortOverPresentColumn(
  sort: ResultViewSort | null,
  columnNames: ReadonlySet<string>
): ResultViewSort | null {
  if (!sort) return null
  if (!columnNames.has(sort.column)) return null
  return sort
}

export function viewFieldsForColumns(
  spec: ResultViewSpec | null,
  columns: ColumnMeta[]
): Pick<SingleResultState, 'sortColumn' | 'sortDirection' | 'filterModel'> {
  const names = new Set(columns.map((column) => column.name))
  const sort = sortOverPresentColumn(spec?.sort ?? null, names)
  return {
    sortColumn: sort?.column ?? null,
    sortDirection: sort?.direction ?? null,
    filterModel: (spec?.filters ?? []).filter((condition) => names.has(condition.column)),
  }
}

export function windowMetaFromResponse(
  response: Pick<MultiQueryResultItem, 'totalRows'> &
    Partial<
      Pick<
        MultiQueryResultItem,
        | 'viewRowCount'
        | 'viewVersion'
        | 'truncated'
        | 'rowCeiling'
        | 'appliedRowLimit'
        | 'fullExportBlockedReason'
        | 'firstWindow'
      >
    >
): {
  fields: Pick<
    SingleResultState,
    | 'viewRowCount'
    | 'viewVersion'
    | 'latestKnownViewVersion'
    | 'truncated'
    | 'rowCeiling'
    | 'appliedRowLimit'
    | 'fullExportBlockedReason'
  >
  window: ResultWindow
} {
  const viewVersion = response.viewVersion ?? 1
  return {
    fields: {
      viewRowCount: response.viewRowCount ?? response.totalRows,
      viewVersion: viewVersion,
      latestKnownViewVersion: viewVersion,
      truncated: response.truncated ?? false,
      rowCeiling: response.rowCeiling ?? 0,
      appliedRowLimit: response.appliedRowLimit ?? null,
      fullExportBlockedReason: response.fullExportBlockedReason ?? null,
    },
    window: response.firstWindow ?? EMPTY_WINDOW,
  }
}

interface ResultLocation {
  tabId: string
  resultIndex: number
}

export interface ResultTarget extends ResultLocation {
  connectionId: string
}

export interface LocatedResult extends ResultLocation {
  result: SingleResultState
}

interface ViewSpecTarget extends ResultLocation {
  spec: ResultViewSpec
}

interface PaintedViewMetrics {
  viewVersion: number
  viewRowCount: number
  totalRows: number
  window?: ResultWindow
}

export interface ViewPaint extends ViewSpecTarget {
  view: PaintedViewMetrics
  extra?: Partial<SingleResultState>
}

export interface ViewChangeRequest extends ViewSpecTarget {
  kind: 'sort' | 'filter'
}

export interface ViewRequestIssue extends ViewSpecTarget {
  seq: number
  baseViewVersion: number
  attempt: number
}
