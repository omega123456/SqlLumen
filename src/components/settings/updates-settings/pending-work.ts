import { useConnectionStore } from '../../../stores/connection-store'
import { useObjectEditorStore } from '../../../stores/object-editor-store'
import { useQueryStore, hasAnyUnsavedEdits } from '../../../stores/query-store'
import { useTableDataStore } from '../../../stores/table-data-store'
import { useTableDesignerStore } from '../../../stores/table-designer-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { hasPendingRowChanges } from '../../../lib/row-edit-state'

export interface PendingWorkSummary {
  hasWork: boolean
  items: string[]
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

type WorkspaceTabType = ReturnType<
  typeof useWorkspaceStore.getState
>['tabsByConnection'][string][number]['type']

function isDirtyDesignerTab(tabId: string): boolean {
  return useTableDesignerStore.getState().tabs[tabId]?.isDirty === true
}

const UNSAVED_TAB_CHECKS: Partial<Record<WorkspaceTabType, (tabId: string) => boolean>> = {
  'table-data': (tabId) =>
    hasPendingRowChanges(useTableDataStore.getState().tabs[tabId]?.editState),
  'table-designer': isDirtyDesignerTab,
  'object-editor': (tabId) => useObjectEditorStore.getState().isDirty(tabId),
}

function hasUnsavedWorkspaceChanges(tab: { id: string; type: WorkspaceTabType }): boolean {
  return UNSAVED_TAB_CHECKS[tab.type]?.(tab.id) === true
}

function countQueryTabWork() {
  const queryTabs = Object.values(useQueryStore.getState().tabs)
  return {
    runningQueries: queryTabs.filter((tab) => tab.tabStatus === 'running').length,
    unsavedTabs: queryTabs.filter(hasAnyUnsavedEdits).length,
  }
}

function countUnsavedWorkspaceTabs(): number {
  const workspaceTabs = Object.values(useWorkspaceStore.getState().tabsByConnection).flat()
  return workspaceTabs.filter(hasUnsavedWorkspaceChanges).length
}

export function buildPendingWorkSummary(): PendingWorkSummary {
  const queryWork = countQueryTabWork()
  const unsavedTabs = queryWork.unsavedTabs + countUnsavedWorkspaceTabs()
  const activeConnections = Object.keys(useConnectionStore.getState().activeConnections).length

  const items: string[] = []
  if (activeConnections > 0) items.push(pluralize(activeConnections, 'active database connection'))
  if (queryWork.runningQueries > 0) items.push(pluralize(queryWork.runningQueries, 'running query'))
  if (unsavedTabs > 0) items.push(pluralize(unsavedTabs, 'unsaved tab'))

  return {
    hasWork: items.length > 0,
    items: items,
  }
}

export type ConfirmAction = 'download' | 'restart'

export const CONFIRM_ACTION_COPY: Record<
  ConfirmAction,
  { title: string; intro: string; confirmLabel: string }
> = {
  download: {
    title: 'Download update?',
    intro: 'Downloading the update may interrupt:',
    confirmLabel: 'Download update',
  },
  restart: {
    title: 'Restart app?',
    intro: 'Restarting SqlLumen will interrupt:',
    confirmLabel: 'Restart app',
  },
}
