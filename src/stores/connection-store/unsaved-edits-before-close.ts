import type { WorkspaceTab } from '../../types/schema'
import { useWorkspaceStore } from '../workspace-store'
import { useQueryStore, type SingleResultState } from '../query-store'
import { useTableDataStore } from '../table-data-store'
import { useObjectEditorStore } from '../object-editor-store'
import { showErrorToast } from '../toast-store'
import { hasModifiedColumns } from '../../lib/row-edit-state'
import { useConnectionStore } from '../connection-store'

const UNSAVED_EDITS_NOT_SAVED_TITLE = 'Connection not closed'

const UNSAVED_EDITS_NOT_SAVED_MESSAGE =
  'Could not save pending edits. Fix or discard changes before closing.'

async function saveRowBeforeClose(save: () => Promise<boolean>): Promise<boolean> {
  const saved = await save()
  if (!saved) {
    showErrorToast(UNSAVED_EDITS_NOT_SAVED_TITLE, UNSAVED_EDITS_NOT_SAVED_MESSAGE)
  }
  return saved
}

async function settleQueryEditorTabBeforeClose(tabId: string): Promise<boolean> {
  const queryTabState = useQueryStore.getState().tabs[tabId]
  if (!queryTabState?.results) return true

  const activeIndex = queryTabState.activeResultIndex ?? 0
  const isDirtyNonActiveResult = (result: SingleResultState, index: number): boolean =>
    index !== activeIndex && hasModifiedColumns(result.editState)
  const hasNonActiveDirty = queryTabState.results.some(isDirtyNonActiveResult)
  if (hasNonActiveDirty) {
    const confirmed = globalThis.confirm(
      'You have unsaved changes in non-active query results. Close connection anyway? Unsaved changes will be lost.'
    )
    if (!confirmed) return false
  }

  const activeResult = queryTabState.results[activeIndex]
  if (!hasModifiedColumns(activeResult?.editState)) return true
  return saveRowBeforeClose(() => useQueryStore.getState().saveCurrentRow(tabId))
}

async function settleTableDataTabBeforeClose(tabId: string): Promise<boolean> {
  const tableDataTabState = useTableDataStore.getState().tabs[tabId]
  if (!hasModifiedColumns(tableDataTabState?.editState)) return true
  return saveRowBeforeClose(() => useTableDataStore.getState().saveCurrentRow(tabId))
}

const SETTLE_TAB_BEFORE_CLOSE: Partial<
  Record<WorkspaceTab['type'], (tabId: string) => Promise<boolean>>
> = {
  'query-editor': settleQueryEditorTabBeforeClose,
  'table-data': settleTableDataTabBeforeClose,
}

function confirmDiscardingObjectEditorChanges(workspaceTabs: WorkspaceTab[]): boolean {
  const objectEditorState = useObjectEditorStore.getState()
  const isDirtyObjectEditorTab = (tab: WorkspaceTab): boolean =>
    tab.type === 'object-editor' && objectEditorState.isDirty(tab.id)
  const hasDirtyObjectEditorTab = workspaceTabs.some(isDirtyObjectEditorTab)
  if (!hasDirtyObjectEditorTab) return true
  return globalThis.confirm(
    'You have unsaved changes in object editor tabs. Close connection anyway?'
  )
}

export async function settleUnsavedEditsBeforeClose(connectionId: string): Promise<boolean> {
  const workspaceTabs = useWorkspaceStore.getState().tabsByConnection[connectionId] ?? []
  for (const tab of workspaceTabs) {
    const settleTab = SETTLE_TAB_BEFORE_CLOSE[tab.type]
    if (!settleTab) continue
    const isSettled = await settleTab(tab.id)
    if (!isSettled) return false
  }
  return confirmDiscardingObjectEditorChanges(workspaceTabs)
}

export function connectionsWithUnsavedEdits(): string[] {
  const sessionIds = Object.keys(useConnectionStore.getState().activeConnections)
  const queryTabs = useQueryStore.getState().tabs
  const tableDataTabs = useTableDataStore.getState().tabs
  const objectEditorState = useObjectEditorStore.getState()
  const dirtySessionIds: string[] = []

  for (const sessionId of sessionIds) {
    const workspaceTabs = useWorkspaceStore.getState().tabsByConnection[sessionId] ?? []
    const hasUnsaved = workspaceTabs.some((tab) => {
      if (tab.type === 'query-editor') {
        const queryTabState = queryTabs[tab.id]
        return (
          queryTabState?.results?.some((result) => hasModifiedColumns(result.editState)) ?? false
        )
      }
      if (tab.type === 'table-data') {
        const tableDataTabState = tableDataTabs[tab.id]
        return hasModifiedColumns(tableDataTabState?.editState)
      }
      if (tab.type === 'object-editor') {
        return objectEditorState.isDirty(tab.id)
      }
      return false
    })
    if (hasUnsaved) {
      dirtySessionIds.push(sessionId)
    }
  }

  return dirtySessionIds
}
