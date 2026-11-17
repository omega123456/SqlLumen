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
import type { ExecutionStatus, SingleResultState } from './query-state-types'
import { viewFieldsForColumns, windowMetaFromResponse } from './result-view-spec'
import type { ResultTarget } from './result-view-spec'

function compositeTableKey(database: string, table: string): string {
  return `${database}.${table}`
}

export function seedResultFromResponse(
  { connectionId, tabId, resultIndex }: ResultTarget,
  response: Pick<MultiQueryResultItem, 'queryId' | 'columns' | 'totalRows'> &
    Partial<MultiQueryResultItem>
): void {
  const { fields, window } = windowMetaFromResponse(response)
  seedResultWindow({
    connectionId: connectionId,
    tabId: tabId,
    resultIndex: resultIndex,
    queryId: response.queryId,
    viewVersion: fields.viewVersion,
    viewRowCount: fields.viewRowCount,
    columns: response.columns,
    window: window,
  })
}

export function buildEditBindingContext(
  result: SingleResultState,
  tableInfo: QueryTableEditInfo,
  metadataSource: Record<string, QueryTableEditInfo> = result.editTableMetadata
): {
  columnBindings: Map<number, string>
  boundColumnIndexMap: Map<string, number>
} {
  const queryTablesInOrder = Object.values(metadataSource)
  const columnBindings = buildQueryEditColumnBindings({
    sql: result.lastExecutedSql,
    resultColumns: result.columns,
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
    resultColumns: result.columns,
    editableMap: result.editableColumnMap,
    primaryKeyColumnNames: primaryKeyColumns,
    columnBindings: result.editColumnBindings,
    boundColumnIndexMap: result.editBoundColumnIndexMap,
  })
  return seedBlobViewerEditValues(baseEditState, {
    row: row,
    tableInfo: tableInfo,
    columnBindings: result.editColumnBindings,
  })
}

export function buildSingleResultFromItem(
  item: MultiQueryResultItem,
  defaultRowLimit: number,
  isActive = false
): SingleResultState {
  const resultStatus: ExecutionStatus = item.error ? 'error' : 'success'
  return {
    ...DEFAULT_RESULT_STATE,
    ...windowMetaFromResponse(item).fields,
    resultStatus: resultStatus,
    columns: item.columns,
    totalRows: item.totalRows,
    exportedRowCount: item.exportedRowCount ?? null,
    executionTimeMs: item.executionTimeMs,
    totalTimeMs: item.totalTimeMs,
    affectedRows: item.affectedRows,
    queryId: item.queryId,
    rowLimit: defaultRowLimit,
    autoLimitApplied: item.autoLimitApplied,
    errorMessage: item.error ?? null,
    lastExecutedSql: item.sourceSql,
    reExecutable: item.reExecutable,
    isAnalyzed: false,
    rowResidency: {
      status: 'resident',
      isActive: isActive,
      inactiveSince: isActive ? null : Date.now(),
    },
  }
}

export function freshResultFields(
  response: ExecuteQueryResult | MultiQueryResultItem,
  spec: ResultViewSpec | null
): Partial<SingleResultState> {
  return {
    ...windowMetaFromResponse(response).fields,
    ...viewFieldsForColumns(spec, response.columns),
    columns: response.columns,
    totalRows: response.totalRows,
    exportedRowCount: null,
    queryId: response.queryId,
    executionTimeMs: response.executionTimeMs,
    totalTimeMs: response.totalTimeMs,
    affectedRows: response.affectedRows,
    autoLimitApplied: response.autoLimitApplied,
    viewRequestSeq: 0,
    isFiltering: false,
    isSorting: false,
    viewError: null,
    pendingWindowRange: null,
    failedWindowRange: null,
    checkedRanges: [],
    selectedRowIndex: null,
    draftRow: null,
  }
}
