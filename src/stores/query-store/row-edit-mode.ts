import type { QueryTableEditInfo } from '../../types/schema'
import { mergeResultPatches } from './query-tab-reducers'
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
import { patchResultByIndex, patchSurface, resultOf, getQueryState } from './query-store-access'
import type { DataViewSurfaceRef } from '../data-view/data-view-types'
import { buildEditBindingContext } from './result-seeding'
import { editMetadataWithTable, warnAboutAmbiguousEditColumns } from './row-edit-builders'

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
  const cachedTableInfo = result.view.editTarget.tables[request.tableName]
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
      expectedQueryId: result.view.slot.queryId,
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
  const ambiguous = findAmbiguousColumns(result.view.slot.columns)
  const metadataSource = editMetadataWithTable(
    result.view.editTarget.tables,
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
    resultColumns: result.view.slot.columns,
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
    view: {
      slot: { connectionId: request.connectionId },
      edit: { state: null, rowIndex: null, saveError: null },
      editTarget: {
        tableName: request.tableName,
        editableColumns: buildEditableColumnMap({
          resultColumns: result.view.slot.columns,
          tableColumns: tableInfo.columns,
          ambiguousNames: ambiguous,
          columnBindings: columnBindings,
        }),
        bindings: columnBindings,
        boundIndexByName: boundColumnIndexMap,
        foreignKeys: mapSingleColumnForeignKeys(tableInfo.foreignKeys),
      },
    },
  })
}

function resultWithColumnsOf(ref: DataViewSurfaceRef): SingleResultState | null {
  const result = resultOf(ref)
  if (!result) return null
  const hasColumns = result.view.slot.columns.length > 0
  return hasColumns ? result : null
}

export async function setEditMode(ref: DataViewSurfaceRef, tableName: string | null) {
  const { tabId, resultIndex } = ref

  if (tableName === null) {
    const keptTables = resultOf(ref)?.view.editTarget.tables ?? EMPTY_OBJECT
    patchSurface(
      ref,
      mergeResultPatches(EDIT_STATE_DEFAULTS, { view: { editTarget: { tables: keptTables } } })
    )
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

export function clearEditState(ref: DataViewSurfaceRef) {
  const tab = getQueryState().tabs[ref.tabId]
  if (!hasResultAt(tab, ref.resultIndex)) return
  patchSurface(ref, { ...EDIT_STATE_DEFAULTS })
}

export function rowEditModeActions() {
  return { setEditMode, clearEditState }
}
