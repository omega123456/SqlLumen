import type { MultiQueryResultItem, QueryTableEditInfo, ResultViewSpec } from '../../types/schema'
import { type ExecuteQueryResult } from '../../lib/query-commands'
import { seedResultWindow } from '../../lib/result-window-cache'
import { buildBoundColumnIndexMap, buildQueryEditColumnBindings } from '../../lib/query-edit-utils'
import { residentRows } from '../data-view/residency'
import { DEFAULT_RESULT_STATE } from './query-state-defaults'
import type { ExecutionStatus, SingleResultState, ResultPatch } from './query-state-types'
import { viewSpecForColumns, windowMetaFromResponse } from './result-view-spec'
import { patchedResult } from './query-tab-reducers'
import type { DataViewPatch, DataViewSlot } from '../data-view/data-view-types'
import type { ResultTarget } from './result-view-spec'

function compositeTableKey(database: string, table: string): string {
  return `${database}.${table}`
}

export function seedResultFromResponse(
  { connectionId, tabId, resultIndex }: ResultTarget,
  response: Pick<MultiQueryResultItem, 'queryId' | 'columns' | 'totalRows'> &
    Partial<MultiQueryResultItem>
): void {
  const { slot, window } = windowMetaFromResponse(response)
  seedResultWindow({
    route: 'query',
    connectionId: connectionId,
    tabId: tabId,
    resultIndex: resultIndex,
    queryId: response.queryId,
    viewVersion: slot.viewVersion,
    viewRowCount: slot.viewRowCount,
    columns: response.columns,
    window: window,
  })
}

export function buildEditBindingContext(
  result: SingleResultState,
  tableInfo: QueryTableEditInfo,
  metadataSource: Record<string, QueryTableEditInfo> = result.view.editTarget.tables
): {
  columnBindings: Map<number, string>
  boundColumnIndexMap: Map<string, number>
} {
  const queryTablesInOrder = Object.values(metadataSource)
  const columnBindings = buildQueryEditColumnBindings({
    sql: result.lastExecutedSql,
    resultColumns: result.view.slot.columns,
    targetTable: tableInfo,
    queryTablesInOrder: queryTablesInOrder,
  })

  return {
    columnBindings: columnBindings,
    boundColumnIndexMap: buildBoundColumnIndexMap(columnBindings),
  }
}

export function buildEditTableMetadata(
  tables: QueryTableEditInfo[]
): Record<string, QueryTableEditInfo> {
  const metadata: Record<string, QueryTableEditInfo> = {}
  for (const table of tables) {
    metadata[compositeTableKey(table.database, table.table)] = table
  }
  return metadata
}

type ResultResponse = ExecuteQueryResult | MultiQueryResultItem

function slotFromResponse(response: ResultResponse): Omit<DataViewSlot, 'connectionId'> {
  return {
    ...windowMetaFromResponse(response).slot,
    columns: response.columns,
    totalRows: response.totalRows,
    queryId: response.queryId,
  }
}

export interface ResultItemSeed {
  item: MultiQueryResultItem
  connectionId: string
  defaultRowLimit: number
  isActive: boolean
}

export function buildSingleResultFromItem(seed: ResultItemSeed): SingleResultState {
  const { item } = seed
  const resultStatus: ExecutionStatus = item.error ? 'error' : 'success'
  return patchedResult(DEFAULT_RESULT_STATE, {
    ...windowMetaFromResponse(item).fields,
    resultStatus: resultStatus,
    exportedRowCount: item.exportedRowCount ?? null,
    executionTimeMs: item.executionTimeMs,
    totalTimeMs: item.totalTimeMs,
    affectedRows: item.affectedRows,
    rowLimit: seed.defaultRowLimit,
    autoLimitApplied: item.autoLimitApplied,
    errorMessage: item.error ?? null,
    lastExecutedSql: item.sourceSql,
    reExecutable: item.reExecutable,
    isAnalyzed: false,
    view: {
      slot: { ...slotFromResponse(item), connectionId: seed.connectionId },
      residency: { rows: residentRows(seed.isActive) },
    },
  })
}

export interface ResultResponseSeed {
  response: ResultResponse
  spec: ResultViewSpec | null
  view?: DataViewPatch
}

export function freshResultFields({ response, spec, view = {} }: ResultResponseSeed): ResultPatch {
  return {
    ...windowMetaFromResponse(response).fields,
    exportedRowCount: null,
    executionTimeMs: response.executionTimeMs,
    totalTimeMs: response.totalTimeMs,
    affectedRows: response.affectedRows,
    autoLimitApplied: response.autoLimitApplied,
    viewRequestSeq: 0,
    view: {
      ...view,
      slot: slotFromResponse(response),
      selection: { rowIndex: null },
      checked: { ranges: [] },
      spec: { ...viewSpecForColumns(spec, response.columns), applying: null, error: null },
      window: { pendingRange: null, failedRange: null },
      edit: { ...view.edit, draftRow: null },
    },
  }
}
