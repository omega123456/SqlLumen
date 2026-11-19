import type { SingleResultState } from '../../../stores/query-store'
import type { FullExportBlockedReason } from '../../../types/schema'
import type { DataToolbarReadiness } from '../../shared/data-view/toolbar/data-toolbar-model'
import { RESULT_GRID_TAB_PANEL, RESULT_TAB_PANEL } from './result-panel-classes'

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

export function queryToolbarReadiness(
  result: SingleResultState,
  displayStatus: DisplayStatus
): DataToolbarReadiness {
  const isDisplayingSuccess = displayStatus === 'success'
  return {
    hasData: result.resultStatus === 'success',
    canInsertRows: isDisplayingSuccess && !result.isAnalyzingQuery,
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
