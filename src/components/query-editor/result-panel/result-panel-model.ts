import type { SingleResultState } from '../../../stores/query-store'
import { readViewRange, type CachedRow } from '../../../lib/result-window-cache'
import { logFrontend } from '../../../lib/app-log-commands'
import { toCachedRow } from '../../../lib/result-row-materializer'
import type {
  ForeignKeyColumnInfo,
  FullExportBlockedReason,
  PrimaryKeyInfo,
  TableDataColumnMeta,
} from '../../../types/schema'
import styles from '../ResultPanel.module.css'
import { toErrorMessage } from '../../../lib/error-message'
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

export function cachedRowFromRowData(
  rowData: Record<string, unknown>,
  columnCount: number
): CachedRow | null {
  return typeof rowData.__baseIdx === 'number' ? toCachedRow(rowData, columnCount) : null
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

function isSelectedRowInView(selectedRowIndex: number | null, viewRowCount: number): boolean {
  if (selectedRowIndex === null) return false
  return selectedRowIndex >= 0 && selectedRowIndex < viewRowCount
}

function isInsertEligibleNonPrimaryColumn(
  column: TableDataColumnMeta,
  editBoundColumnIndexMap: Map<string, number>
): boolean {
  if (column.isPrimaryKey) return false
  return editBoundColumnIndexMap.has(column.name.toLowerCase())
}

function hasInsertEligibleNonPrimaryColumns(
  editTableColumns: TableDataColumnMeta[],
  editBoundColumnIndexMap: Map<string, number>
): boolean {
  return editTableColumns.some((column) =>
    isInsertEligibleNonPrimaryColumn(column, editBoundColumnIndexMap)
  )
}

interface CloneAvailability {
  result: SingleResultState
  displayStatus: DisplayStatus
  editTableColumns: TableDataColumnMeta[]
  primaryKey: PrimaryKeyInfo | null
}

function isCloneBlockedByEditing(result: SingleResultState): boolean {
  const selectedRowIsDraft =
    result.editState?.isNewRow === true && result.editingRowIndex === result.selectedRowIndex
  return hasPendingRowChanges(result.editState) || selectedRowIsDraft
}

export function isCloneDisabled(availability: CloneAvailability): boolean {
  const { result, primaryKey } = availability
  if (result.editMode === null) return true
  if (availability.displayStatus !== 'success') return true
  if (result.isAnalyzingQuery) return true
  if (result.viewMode === 'text') return true
  if (isCloneBlockedByEditing(result)) return true
  if (!isSelectedRowInView(result.selectedRowIndex, result.viewRowCount)) return true
  if (!primaryKey) return true
  if (primaryKey.isUniqueKeyFallback) return true
  return !hasInsertEligibleNonPrimaryColumns(
    availability.editTableColumns,
    result.editBoundColumnIndexMap
  )
}

export function gridTabPanelClassNameFor(viewMode: string, columnCount: number): string {
  const isGridWithColumns = viewMode === 'grid' && columnCount > 0
  return isGridWithColumns ? `${styles.tabPanel} ${styles.gridTabPanel}` : styles.tabPanel
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

export function rowIndexFromRowData(rowData: Record<string, unknown>): number {
  const rowIndexRaw = rowData.__rowIdx
  return typeof rowIndexRaw === 'number' ? rowIndexRaw : 0
}

interface LookupRowRequest {
  tabId: string
  resultIndex: number
  rowIndex: number
}

export async function resolveLookupRow(
  rowData: Record<string, unknown>,
  columnCount: number,
  request: LookupRowRequest
): Promise<CachedRow | undefined> {
  const fromGrid = cachedRowFromRowData(rowData, columnCount)
  if (fromGrid) return fromGrid
  const { tabId, resultIndex, rowIndex } = request
  try {
    const fetched = await readViewRange({
      tabId: tabId,
      resultIndex: resultIndex,
      range: [rowIndex, rowIndex + 1],
    })
    return fetched[0]
  } catch (error) {
    logFrontend(
      'warn',
      `[result-panel] FK lookup could not load row ${rowIndex + 1}: ${toErrorMessage(error)}`
    )
    return undefined
  }
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

export interface ForeignKeyLookupContext {
  columnKey: string
  sourceColumn: string
  currentValue: unknown
  foreignKey: ForeignKeyColumnInfo
  rowData: Record<string, unknown>
}

interface ForeignKeyLookupTargetInputs {
  context: ForeignKeyLookupContext | null
  editMode: string | null
  editTable: ReturnType<typeof readEditTable>['editTable']
}

export function resolveForeignKeyLookupTarget(inputs: ForeignKeyLookupTargetInputs) {
  const { context, editMode, editTable } = inputs
  if (!context) return null
  if (!editMode) return null
  return {
    context: context,
    database: context.foreignKey.referencedDatabase || editTable?.database || '',
    sourceTable: editTable?.table ?? editMode,
  }
}
