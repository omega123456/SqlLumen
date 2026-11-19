import {
  cloneSourceRowIndex,
  copiedBoundColumnNames,
  type SingleResultState,
} from '../../../stores/query-store'
import type { DataViewLocation } from '../../../types/shared-data-view'
import type {
  FullExportBlockedReason,
  PrimaryKeyInfo,
  TableDataColumnMeta,
} from '../../../types/schema'
import { RESULT_GRID_TAB_PANEL, RESULT_TAB_PANEL } from './result-panel-classes'
import { hasPendingRowChanges } from '../../../lib/row-edit-state'

export const EMPTY_TABLE_COLUMNS: TableDataColumnMeta[] = []

export const TRUNCATION_MESSAGES: Record<FullExportBlockedReason | 'none', string> = {
  none: 'Result truncated. This query returned more rows than the maximum rows kept per result.',
  call: 'Result truncated. Exporting all rows would run this stored procedure again and repeat its changes. To keep more rows in future runs, raise Maximum rows kept per result in Settings.',
  locking:
    'Result truncated. Exporting all rows would run this locking query again and take its locks again. To export every row, remove the locking clause and run the query again.',
  unknownDatabase:
    "Result truncated. The database this query ran in couldn't be recorded, so all rows can't be exported. Run the query again to enable full export.",
}

export type DisplayStatus = SingleResultState['resultStatus'] | 'running' | 'restoring' | 'idle'

interface DisplayStatusInputs {
  tabStatus: string
  rowResidencyStatus: string
  resultStatus: SingleResultState['resultStatus']
}

export function resolveDisplayStatus(inputs: DisplayStatusInputs): DisplayStatus {
  if (inputs.tabStatus === 'running') return 'running'
  if (inputs.rowResidencyStatus === 'restoring') return 'restoring'
  if (inputs.tabStatus === 'idle') return 'idle'
  return inputs.resultStatus
}

interface RowInsertionInputs {
  result: SingleResultState
  displayStatus: DisplayStatus
  editTableColumns: TableDataColumnMeta[]
  primaryKey: PrimaryKeyInfo | null
}

export interface ResultRowInsertion {
  canAddRow: boolean
  canCloneSelection: boolean
}

export const NO_ROW_INSERTION: ResultRowInsertion = { canAddRow: false, canCloneSelection: false }

function isCloneBlockedByEditing(result: SingleResultState): boolean {
  const selectedRowIsDraft =
    result.editState?.isNewRow === true && result.editingRowIndex === result.selectedRowIndex
  return hasPendingRowChanges(result.editState) || selectedRowIsDraft
}

function isRowInsertionBlocked(inputs: RowInsertionInputs): boolean {
  const { result, primaryKey } = inputs
  if (result.editMode === null) return true
  if (inputs.displayStatus !== 'success') return true
  if (result.isAnalyzingQuery) return true
  if (result.viewMode === 'text') return true
  if (!primaryKey) return true
  return primaryKey.isUniqueKeyFallback
}

function canAddResultRow(inputs: RowInsertionInputs): boolean {
  if (isRowInsertionBlocked(inputs)) return false
  return inputs.result.draftRow === null
}

function hasCopiedBoundColumns(inputs: RowInsertionInputs): boolean {
  const cloneTable = { columns: inputs.editTableColumns, primaryKey: inputs.primaryKey }
  return copiedBoundColumnNames(inputs.result, cloneTable).size > 0
}

function canCloneResultRow(inputs: RowInsertionInputs): boolean {
  const { result } = inputs
  if (isRowInsertionBlocked(inputs)) return false
  if (isCloneBlockedByEditing(result)) return false
  const hasCloneSource = cloneSourceRowIndex(result) !== null
  if (!hasCloneSource) return false
  return hasCopiedBoundColumns(inputs)
}

export function resultRowInsertion(inputs: RowInsertionInputs): ResultRowInsertion {
  return {
    canAddRow: canAddResultRow(inputs),
    canCloneSelection: canCloneResultRow(inputs),
  }
}

export function gridTabPanelClassNameFor(viewMode: string, columnCount: number): string {
  const isGridWithColumns = viewMode === 'grid' && columnCount > 0
  if (isGridWithColumns) return RESULT_GRID_TAB_PANEL
  return RESULT_TAB_PANEL
}

export interface TabPanelAttributes {
  role?: string
  id?: string
  'aria-labelledby'?: string
}

export function resultTabPanelAttributes(
  hideSubTabs: boolean,
  panelId: string,
  labelledBy: string | undefined
): TabPanelAttributes {
  if (hideSubTabs) return {}
  return { role: 'tabpanel', id: panelId, 'aria-labelledby': labelledBy }
}

export function dmlSuccessMessage(affectedRows: number): string {
  if (affectedRows <= 0) return 'Query executed successfully'
  return `${affectedRows} ${affectedRows === 1 ? 'row' : 'rows'} affected`
}

export function readEditTable(result: SingleResultState) {
  const editTable = result.editMode ? result.editTableMetadata[result.editMode] : undefined
  return {
    editTable: editTable,
    primaryKey: editTable?.primaryKey ?? null,
    editTableColumns: editTable?.columns ?? EMPTY_TABLE_COLUMNS,
  }
}

export function hasVisibleSubTabs(hideSubTabs: boolean, resultCount: number): boolean {
  return !hideSubTabs && resultCount > 1
}

export function subTabLabelledBy(
  showsSubTabs: boolean,
  tabId: string,
  resultIndex: number
): string | undefined {
  return showsSubTabs ? `result-tab-${tabId}-${resultIndex}` : undefined
}

export function shouldShowExpiredState(isExpired: boolean, displayStatus: DisplayStatus): boolean {
  return isExpired && displayStatus !== 'running'
}

interface ResultEditTarget {
  editMode: string | null
  editTable: ReturnType<typeof readEditTable>['editTable']
}

export function resultEditLocation(
  connectionId: string,
  { editMode, editTable }: ResultEditTarget
): DataViewLocation | null {
  if (!editMode) return null
  return {
    connectionId: connectionId,
    database: editTable?.database ?? '',
    table: editTable?.table ?? editMode,
  }
}
