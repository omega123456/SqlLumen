import { create } from 'zustand'
import type {
  WorkspaceTab,
  TableDataTab,
  TableDesignerTab,
  ObjectEditorTab,
  DistributiveOmit,
} from '../types/schema'
import { useSettingsStore } from './settings-store'
import { type WorkspaceTabStackKey } from '../lib/workspace-tab-stacks'
import { type ObjectScopedTab } from './workspace-store/workspace-tab-lists'
import type { DroppedObjectTarget, ObjectRename } from './workspace-store/object-tab-matching'
import { tabOpenActions } from './workspace-store/tab-open-actions'
import { tabCloseActions } from './workspace-store/tab-close-actions'
import { tabUpdateActions } from './workspace-store/tab-update-actions'

export type { DroppedObjectTarget, ObjectRename } from './workspace-store/object-tab-matching'
export { _resetQueryTabCounter } from './workspace-store/tab-open-actions'

export type WorkspaceFocusSurface = 'editor' | 'ai-input'

let tabIdCounter = 0

export function _resetTabIdCounter() {
  tabIdCounter = 0
}

export function generateTabId(): string {
  return `tab-${++tabIdCounter}`
}

export type OpenableTab = DistributiveOmit<ObjectScopedTab, 'id'>

export interface WorkspaceState {
  tabsByConnection: Record<string, WorkspaceTab[]>

  activeTabByConnection: Record<string, string | null>

  visibleConnectionSessionId: string
  stackRecencyByConnection: Record<string, Partial<Record<WorkspaceTabStackKey, string>>>
  tabLastUsedAt: Record<string, number>

  lastFocusedSurfaceByTab: Record<string, WorkspaceFocusSurface>
  blockingNavigationByTab: Record<string, boolean>
  pendingCascadeClose: {
    queryTabId: string
    queryResultItems: string[]
    tableDataItems: string[]
    onConfirm: () => void
    onCancel: () => void
  } | null

  openTab: (tab: OpenableTab) => void
  restoreTableDataTab: (tab: Omit<TableDataTab, 'id'>) => string
  openQueryTab: (connectionId: string, label?: string) => string
  openHistoryTab: (connectionId: string, activate?: boolean) => void
  openProcessListTab: (connectionId: string) => void
  closeTab: (connectionId: string, tabId: string) => void
  forceCloseTab: (connectionId: string, tabId: string) => void
  setActiveTab: (connectionId: string, tabId: string) => void
  requestActivateTab: (tabId: string) => void
  setLastFocusedSurface: (tabId: string, surface: WorkspaceFocusSurface) => void
  setBlockingNavigation: (tabId: string, blocking: boolean) => void
  renameQueryTab: (connectionId: string, tabId: string, nextLabel: string) => void
  reorderWorkspaceTab: (connectionId: string, tabId: string, insertIndex: number) => void
  closeTabsByDatabase: (connectionId: string, databaseName: string) => void
  closeTabsByObject: (connectionId: string, target: DroppedObjectTarget) => void
  updateTabDatabase: (connectionId: string, oldDatabase: string, newDatabase: string) => void
  updateTabObject: (connectionId: string, rename: ObjectRename) => void
  updateTableDesignerTab: (
    tabId: string,
    partial: Partial<Omit<TableDesignerTab, 'type' | 'id'>>
  ) => void
  updateObjectEditorTab: (
    tabId: string,
    partial: Partial<Omit<ObjectEditorTab, 'type' | 'id'>>
  ) => void
  setSubTab: (connectionId: string, tabId: string, subTab: WorkspaceTab['subTabId']) => void
  clearConnectionTabs: (connectionId: string) => void
  normalizeTableDataTabScopes: () => void
  setVisibleConnectionSession: (newSessionId: string) => void
  resetStackRecency: (connectionId?: string) => void
}

export const useWorkspaceStore = create<WorkspaceState>()(() => ({
  tabsByConnection: {},
  activeTabByConnection: {},
  visibleConnectionSessionId: '',
  stackRecencyByConnection: {},
  tabLastUsedAt: {},
  lastFocusedSurfaceByTab: {},
  blockingNavigationByTab: {},
  pendingCascadeClose: null,
  ...tabOpenActions(),
  ...tabCloseActions(),
  ...tabUpdateActions(),
}))

let previousTableTabsInBottomPanelSetting = useSettingsStore
  .getState()
  .getSetting('results.tableTabsInBottomPanel')

useSettingsStore.subscribe((state) => {
  const nextSetting = state.getSetting('results.tableTabsInBottomPanel')
  const isTurningBottomPanelTablesOff =
    previousTableTabsInBottomPanelSetting === 'true' && nextSetting === 'false'
  if (isTurningBottomPanelTablesOff) {
    useWorkspaceStore.getState().normalizeTableDataTabScopes()
  }
  previousTableTabsInBottomPanelSetting = nextSetting
})
