import type { QueryTableEditInfo } from '../../types/schema'
import { type CachedRow } from '../../lib/result-window-cache'
import { showErrorToast } from '../toast-store'
import {
  findAmbiguousColumns,
  buildEditableColumnMap,
  validateKeyColumnsPresent,
} from '../../lib/query-edit-utils'
import { mapSingleColumnForeignKeys } from '../../lib/foreign-key-utils'
import { logFrontendError } from '../../lib/app-log-commands'
import { toErrorMessage } from '../../lib/error-message'
import { hasResultAt } from './result-lists'
import { runEditAnalysis } from './edit-analysis'
import { EDIT_STATE_DEFAULTS, EMPTY_OBJECT } from './query-state-defaults'
import type { SingleResultState } from './query-state-types'
import {
  patchResultByIndex,
  patchSurface,
  resultAt,
  resultOf,
  rowAt,
  getQueryState,
} from './query-store-access'
import type { DataViewSurfaceRef } from '../data-view/data-view-types'
import { buildEditBindingContext, buildSeededRowEditState } from './result-seeding'
import type { LocatedResult } from './result-view-spec'
import { editMetadataWithTable, warnAboutAmbiguousEditColumns } from './row-edit-builders'

export function ensureResultEditState(
  located: LocatedResult,
  rowIndex: number
): SingleResultState | null {
  const { tabId, resultIndex, result } = located
  if (!result.editMode) return null

  const tableInfo = result.editTableMetadata[result.editMode]
  const cached = rowAt(located, rowIndex)
  if (!tableInfo) return null
  if (!cached) return null
  const row = cached.row
  if (!row) return null

  const isAlreadyEditingRow = Boolean(result.editState) && result.editingRowIndex === rowIndex
  if (isAlreadyEditingRow) {
    return result
  }

  patchResultByIndex(tabId, resultIndex, {
    editState: buildSeededRowEditState(result, tableInfo, row),
    editingRowIndex: rowIndex,
    editingBaseIndex: cached.baseIndex >= 0 ? cached.baseIndex : null,
    saveError: null,
  })

  return resultAt(tabId, resultIndex) ?? null
}

interface EditModeRequest {
  connectionId: string
  tabId: string
  resultIndex: number
  tableName: string
}

interface EditModeActivation {
  request: EditModeRequest
  result: SingleResultState
  tableInfo: QueryTableEditInfo
  keyColumns: string[]
}

async function loadEditTableInfo(
  request: EditModeRequest,
  result: SingleResultState
): Promise<QueryTableEditInfo | null> {
  const cachedTableInfo = result.editTableMetadata[request.tableName]
  if (cachedTableInfo) return cachedTableInfo

  if (!result.lastExecutedSql) {
    showErrorToast('Edit mode failed', 'No SQL query available for analysis')
    return null
  }

  try {
    const metadata = await runEditAnalysis({
      tabId: request.tabId,
      connectionId: request.connectionId,
      sql: result.lastExecutedSql,
      expectedQueryId: result.queryId,
      resultIndex: request.resultIndex,
    })
    if (!metadata) return null
    const tableInfo = metadata[request.tableName]
    if (!tableInfo) {
      showErrorToast('Edit mode failed', `Table metadata not available for ${request.tableName}`)
      return null
    }
    return tableInfo
  } catch (error) {
    logFrontendError('[query-store] setEditMode analyze_query_for_edit failed:', error)
    showErrorToast('Edit mode failed', toErrorMessage(error))
    return null
  }
}

function activateEditMode(activation: EditModeActivation) {
  const { request, result, tableInfo, keyColumns } = activation
  const ambiguous = findAmbiguousColumns(result.columns)
  const metadataSource = editMetadataWithTable(
    result.editTableMetadata,
    request.tableName,
    tableInfo
  )
  const { columnBindings, boundColumnIndexMap } = buildEditBindingContext(
    result,
    tableInfo,
    metadataSource
  )

  const validation = validateKeyColumnsPresent({
    primaryKeyColumns: keyColumns,
    resultColumns: result.columns,
    ambiguousNames: ambiguous,
    boundColumnIndexMap: boundColumnIndexMap,
  })
  if (!validation.valid) {
    showErrorToast(
      'Edit mode failed',
      `Cannot edit ${request.tableName}: result set does not contain the unique key columns (${validation.missingColumns.join(', ')})`
    )
    return
  }

  warnAboutAmbiguousEditColumns({
    tableInfo: tableInfo,
    keyColumns: keyColumns,
    ambiguous: ambiguous,
    boundColumnIndexMap: boundColumnIndexMap,
  })

  patchResultByIndex(request.tabId, request.resultIndex, {
    editMode: request.tableName,
    editableColumnMap: buildEditableColumnMap({
      resultColumns: result.columns,
      tableColumns: tableInfo.columns,
      ambiguousNames: ambiguous,
      columnBindings: columnBindings,
    }),
    editColumnBindings: columnBindings,
    editBoundColumnIndexMap: boundColumnIndexMap,
    editForeignKeys: mapSingleColumnForeignKeys(tableInfo.foreignKeys),
    editState: null,
    editConnectionId: request.connectionId,
    editingRowIndex: null,
    saveError: null,
  })
}

function resultWithColumnsOf(ref: DataViewSurfaceRef): SingleResultState | null {
  const result = resultOf(ref)
  if (!result) return null
  const hasColumns = result.columns.length > 0
  return hasColumns ? result : null
}

export async function setEditMode(ref: DataViewSurfaceRef, tableName: string | null) {
  const { tabId, resultIndex } = ref

  if (tableName === null) {
    patchSurface(ref, {
      ...EDIT_STATE_DEFAULTS,
      editTableMetadata: resultOf(ref)?.editTableMetadata ?? EMPTY_OBJECT,
    })
    return
  }

  const connectionId = getQueryState().tabs[tabId]?.connectionId
  const result = resultWithColumnsOf(ref)
  if (!connectionId) return
  if (!result) return

  const request: EditModeRequest = {
    connectionId: connectionId,
    tabId: tabId,
    resultIndex: resultIndex,
    tableName: tableName,
  }
  const tableInfo = await loadEditTableInfo(request, result)
  if (!tableInfo) return

  if (!tableInfo.primaryKey) {
    showErrorToast('Edit mode failed', `Cannot edit ${tableName}: no primary or unique key`)
    return
  }

  const currentResult = resultOf(ref)
  if (!currentResult) return

  activateEditMode({
    request: request,
    result: currentResult,
    tableInfo: tableInfo,
    keyColumns: tableInfo.primaryKey.keyColumns,
  })
}

export function startEditingRow(ref: DataViewSurfaceRef, rowIndex: number, cachedRow?: CachedRow) {
  const { tabId, resultIndex } = ref
  const result = resultOf(ref)
  if (!result?.editMode) return
  if (!result.editTableMetadata[result.editMode]) return

  const cached =
    cachedRow ?? rowAt({ tabId: tabId, resultIndex: resultIndex, result: result }, rowIndex)
  if (!cached) return
  const row = cached.row

  const tableInfo = result.editTableMetadata[result.editMode]
  patchSurface(ref, {
    editState: buildSeededRowEditState(result, tableInfo, row),
    editingRowIndex: rowIndex,
    editingBaseIndex: cached.baseIndex >= 0 ? cached.baseIndex : null,
    saveError: null,
  })
}

export function discardCurrentRow(ref: DataViewSurfaceRef) {
  const result = resultOf(ref)
  if (!result?.editState) return

  patchSurface(ref, {
    ...(result.editState.isNewRow ? { draftRow: null, selectedRowIndex: null } : {}),
    editState: null,
    editingRowIndex: null,
    editingBaseIndex: null,
    saveError: null,
  })
}

export function clearEditState(ref: DataViewSurfaceRef) {
  const tab = getQueryState().tabs[ref.tabId]
  if (!hasResultAt(tab, ref.resultIndex)) return
  patchSurface(ref, { ...EDIT_STATE_DEFAULTS })
}

export function rowEditModeActions() {
  return { setEditMode, startEditingRow, discardCurrentRow, clearEditState }
}
