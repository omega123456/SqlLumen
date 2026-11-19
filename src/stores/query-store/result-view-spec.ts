import type {
  ColumnMeta,
  MultiQueryResultItem,
  ResultViewSort,
  ResultViewSpec,
  ResultWindow,
} from '../../types/schema'
import { EMPTY_WINDOW } from './query-state-defaults'
import type { DataViewSlot, DataViewSpecState } from '../data-view/data-view-types'
import type { SingleResultState } from './query-state-types'

export function getResultViewSpec(result: SingleResultState): ResultViewSpec {
  return { sort: result.view.spec.sort, filters: result.view.spec.filters }
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

export function viewSpecForColumns(
  spec: ResultViewSpec | null,
  columns: ColumnMeta[]
): Pick<DataViewSpecState, 'sort' | 'filters'> {
  const names = new Set(columns.map((column) => column.name))
  return {
    sort: sortOverPresentColumn(spec?.sort ?? null, names),
    filters: (spec?.filters ?? []).filter((condition) => names.has(condition.column)),
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
    | 'latestKnownViewVersion'
    | 'truncated'
    | 'rowCeiling'
    | 'appliedRowLimit'
    | 'fullExportBlockedReason'
  >
  slot: Pick<DataViewSlot, 'viewVersion' | 'viewRowCount'>
  window: ResultWindow
} {
  const viewVersion = response.viewVersion ?? 1
  return {
    slot: {
      viewRowCount: response.viewRowCount ?? response.totalRows,
      viewVersion: viewVersion,
    },
    fields: {
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

export interface ViewRequestIssue extends ViewSpecTarget {
  seq: number
  baseViewVersion: number
  attempt: number
}
