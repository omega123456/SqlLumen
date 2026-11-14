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
  getActiveIndex,
  patchResultByIndex,
  resultAt,
  rowAt,
  getQueryState,
} from './query-store-access'
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

export async function setEditMode(connectionId: string, tabId: string, tableName: string | null) {
  const resultIndex = getActiveIndex(tabId)

  if (tableName === null) {
    patchResultByIndex(tabId, resultIndex, {
      ...EDIT_STATE_DEFAULTS,
      editTableMetadata: resultAt(tabId, resultIndex)?.editTableMetadata ?? EMPTY_OBJECT,
    })
    return
  }

  const result = resultAt(tabId, resultIndex)
  if (!result) return
  const hasColumns = result.columns.length > 0
  if (!hasColumns) return

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

  const currentResult = resultAt(tabId, resultIndex)
  if (!currentResult) return

  activateEditMode({
    request: request,
    result: currentResult,
    tableInfo: tableInfo,
    keyColumns: tableInfo.primaryKey.keyColumns,
  })
}

export function startEditingRow(tabId: string, rowIndex: number, cachedRow?: CachedRow) {
  const resultIndex = getActiveIndex(tabId)
  const tab = getQueryState().tabs[tabId]
  const result = tab?.results[resultIndex]
  if (!result?.editMode) return
  if (!result.editTableMetadata[result.editMode]) return

  const cached =
    cachedRow ?? rowAt({ tabId: tabId, resultIndex: resultIndex, result: result }, rowIndex)
  if (!cached) return
  const row = cached.row

  const tableInfo = result.editTableMetadata[result.editMode]
  patchResultByIndex(tabId, resultIndex, {
    editState: buildSeededRowEditState(result, tableInfo, row),
    editingRowIndex: rowIndex,
    editingBaseIndex: cached.baseIndex >= 0 ? cached.baseIndex : null,
    saveError: null,
  })
}

export function discardCurrentRow(tabId: string) {
  const resultIndex = getActiveIndex(tabId)
  const tab = getQueryState().tabs[tabId]
  const result = tab?.results[resultIndex]
  if (!result?.editState) return

  patchResultByIndex(tabId, resultIndex, {
    ...(result.editState.isNewRow ? { draftRow: null, selectedRowIndex: null } : {}),
    editState: null,
    editingRowIndex: null,
    editingBaseIndex: null,
    saveError: null,
  })
}

export function clearEditState(tabId: string) {
  const tab = getQueryState().tabs[tabId]
  if (!tab) return
  const resultIndex = getActiveIndex(tabId)
  if (hasResultAt(tab, resultIndex)) {
    patchResultByIndex(tabId, resultIndex, { ...EDIT_STATE_DEFAULTS })
  }
}

export function rowEditModeActions() {
  return { setEditMode, startEditingRow, discardCurrentRow, clearEditState }
}
