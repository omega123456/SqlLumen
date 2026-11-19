import type {
  BlobEnvelope,
  MultiQueryResultItem,
  QueryTableEditInfo,
  ResultViewSpec,
  RowEditState,
} from '../../types/schema'
import { type ExecuteQueryResult } from '../../lib/query-commands'
import { seedResultWindow } from '../../lib/result-window-cache'
import {
  buildBoundColumnIndexMap,
  buildQueryEditColumnBindings,
  buildRowEditState,
} from '../../lib/query-edit-utils'
import { isBlobEnvelope } from '../../lib/blob-utils'
import { DEFAULT_RESULT_STATE } from './query-state-defaults'
import type { ExecutionStatus, SingleResultState, ResultPatch } from './query-state-types'
import { viewSpecForColumns, windowMetaFromResponse } from './result-view-spec'
import { patchedResult } from './query-tab-reducers'
import type { DataViewPatch, DataViewResidency, DataViewSlot } from '../data-view/data-view-types'
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

const DISPLAYED_BLOB_VALUE_BY_KIND: Record<
  BlobEnvelope['kind'],
  (envelope: BlobEnvelope) => unknown
> = {
  null: () => null,
  empty: () => '',
  bytes: (envelope) => envelope.base64 ?? '',
}

export function toDisplayedQueryCellValue(value: unknown): unknown {
  if (!isBlobEnvelope(value)) {
    return value
  }
  return DISPLAYED_BLOB_VALUE_BY_KIND[value.kind](value)
}

interface BlobEditSeed {
  row: unknown[]
  tableInfo: QueryTableEditInfo
  columnBindings: Map<number, string>
}

function seedBlobViewerEditValues(
  editState: RowEditState,
  { row, tableInfo, columnBindings }: BlobEditSeed
): RowEditState {
  const binaryColumns = new Map(
    tableInfo.columns
      .filter((column) => column.isBinary)
      .map((column) => [column.name.toLowerCase(), column.name])
  )

  if (binaryColumns.size === 0) {
    return editState
  }

  const originalValues = { ...editState.originalValues }
  const currentValues = { ...editState.currentValues }
  let changed = false

  for (const [resultColumnIndex, columnName] of columnBindings) {
    const binaryColumnName = binaryColumns.get(columnName.toLowerCase())
    if (!binaryColumnName) continue

    if (!(binaryColumnName in originalValues)) {
      originalValues[binaryColumnName] = row[resultColumnIndex] ?? null
      changed = true
    }
    if (!(binaryColumnName in currentValues)) {
      currentValues[binaryColumnName] = row[resultColumnIndex] ?? null
      changed = true
    }
  }

  return changed ? { ...editState, originalValues, currentValues } : editState
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

export function buildSeededRowEditState(
  result: SingleResultState,
  tableInfo: QueryTableEditInfo,
  row: unknown[]
): RowEditState {
  const primaryKeyColumns = tableInfo.primaryKey?.keyColumns ?? []
  const baseEditState = buildRowEditState({
    row: row,
    resultColumns: result.view.slot.columns,
    editableMap: result.view.editTarget.editableColumns,
    primaryKeyColumnNames: primaryKeyColumns,
    columnBindings: result.view.editTarget.bindings,
    boundColumnIndexMap: result.view.editTarget.boundIndexByName,
  })
  return seedBlobViewerEditValues(baseEditState, {
    row: row,
    tableInfo: tableInfo,
    columnBindings: result.view.editTarget.bindings,
  })
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

export function residentRows(isActive: boolean): DataViewResidency['rows'] {
  return {
    status: 'resident',
    isActive: isActive,
    inactiveSince: isActive ? null : Date.now(),
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
