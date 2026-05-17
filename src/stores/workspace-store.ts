import { create } from 'zustand'
import type {
  WorkspaceTab,
  SchemaInfoTab,
  TableDataTab,
  TableDesignerTab,
  ObjectEditorTab,
  HistoryTab,
  ProcessListTab,
  EditableObjectType,
  DistributiveOmit,
} from '../types/schema'
import { useQueryStore } from './query-store'
import { useTableDataStore } from './table-data-store'
import { useTableDesignerStore } from './table-designer-store'
import { useObjectEditorStore } from './object-editor-store'
import { useAiStore } from './ai-store'
import { useSettingsStore } from './settings-store'

export type WorkspaceFocusSurface = 'editor' | 'ai-input'

// ---------------------------------------------------------------------------
// Tab ID generation
// ---------------------------------------------------------------------------

let tabIdCounter = 0
let queryTabCounter = 0

/** Reset the counter — for testing only. */
export function _resetTabIdCounter() {
  tabIdCounter = 0
}

export function _resetQueryTabCounter() {
  queryTabCounter = 0
}

function generateTabId(): string {
  return `tab-${++tabIdCounter}`
}

type ObjectScopedTab = SchemaInfoTab | TableDataTab | TableDesignerTab | ObjectEditorTab

/** The tab types that openTab accepts. */
type OpenableTab = DistributiveOmit<ObjectScopedTab, 'id'>

interface WorkspaceState {
  /** Tabs per connection ID. */
  tabsByConnection: Record<string, WorkspaceTab[]>

  /** Active tab ID per connection. */
  activeTabByConnection: Record<string, string | null>

  lastFocusedSurfaceByTab: Record<string, WorkspaceFocusSurface>
  blockingNavigationByTab: Record<string, boolean>
  pendingCascadeClose: {
    queryTabId: string
    queryResultItems: string[]
    tableDataItems: string[]
    onConfirm: () => void
    onCancel: () => void
  } | null

  // Actions
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
  closeTabsByObject: (
    connectionId: string,
    databaseName: string,
    objectName: string,
    objectType?: EditableObjectType
  ) => void
  updateTabDatabase: (connectionId: string, oldDatabase: string, newDatabase: string) => void
  updateTabObject: (
    connectionId: string,
    databaseName: string,
    oldObjectName: string,
    newObjectName: string
  ) => void
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
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isObjectScopedTab(tab: WorkspaceTab): tab is ObjectScopedTab {
  return (
    tab.type === 'schema-info' ||
    tab.type === 'table-data' ||
    tab.type === 'table-designer' ||
    tab.type === 'object-editor'
  )
}

/** Maps EditableObjectType to the display label for object-editor tabs. */
const OBJECT_EDITOR_TYPE_LABELS: Record<EditableObjectType, string> = {
  procedure: 'Stored Procedure',
  function: 'Function',
  trigger: 'Trigger',
  event: 'Event',
  view: 'View',
}

function getObjectEditorLabel(objectType: EditableObjectType, objectName: string): string {
  return `${OBJECT_EDITOR_TYPE_LABELS[objectType]}: ${objectName}`
}

function getUpdatedObjectTabLabel(
  tab: ObjectScopedTab,
  objectName: string = tab.objectName
): string {
  if (tab.type === 'table-designer') {
    return objectName
  }

  if (tab.type === 'object-editor') {
    return getObjectEditorLabel(tab.objectType, objectName)
  }

  return objectName
}

/**
 * Get the best active tab after a change.
 * Keeps the current active if still present, else picks the first remaining tab.
 */
function selectActiveTabAfterChange(
  currentActiveId: string | null,
  newTabs: WorkspaceTab[]
): string | null {
  if (currentActiveId && newTabs.some((t) => t.id === currentActiveId)) {
    return currentActiveId
  }
  return newTabs.length > 0 ? newTabs[0].id : null
}

/**
 * Update tabs for a connection by applying a transform function,
 * then recompute the active tab.
 */
function updateConnectionTabs(
  state: WorkspaceState,
  connectionId: string,
  transform: (tabs: WorkspaceTab[]) => WorkspaceTab[]
): Partial<WorkspaceState> {
  const tabs = state.tabsByConnection[connectionId] || []
  const newTabs = transform(tabs)
  const currentActive = state.activeTabByConnection[connectionId] ?? null
  const newActive = selectActiveTabAfterChange(currentActive, newTabs)

  return {
    tabsByConnection: {
      ...state.tabsByConnection,
      [connectionId]: newTabs,
    },
    activeTabByConnection: {
      ...state.activeTabByConnection,
      [connectionId]: newActive,
    },
  }
}

function isPinnedWorkspaceTab(tab: WorkspaceTab): boolean {
  return tab.type === 'history' || tab.type === 'processlist'
}

function isTableTabsInBottomPanelEnabled(): boolean {
  return useSettingsStore.getState().getSetting('results.tableTabsInBottomPanel') === 'true'
}

function getTableDataIdentityKey(
  tab: Pick<TableDataTab, 'connectionId' | 'databaseName' | 'objectName'>
) {
  return `${tab.connectionId}::${tab.databaseName}::${tab.objectName}`
}

function getMovableTabGroupId(tab: WorkspaceTab): string {
  if (tab.type === 'table-data' && tab.parentQueryTabId) {
    return tab.parentQueryTabId
  }
  return tab.id
}

function normalizeScopedTableDataTabs(tabs: WorkspaceTab[]): {
  tabs: WorkspaceTab[]
  removedTableTabIds: string[]
  remappedTableTabIds: Map<string, string>
} {
  let changed = false
  const normalizedTabs: WorkspaceTab[] = []
  const standaloneTableTabIdsByKey = new Map<string, string>()
  const removedTableTabIds: string[] = []
  const remappedTableTabIds = new Map<string, string>()

  for (const tab of tabs) {
    if (tab.type !== 'table-data') {
      normalizedTabs.push(tab)
      continue
    }

    const normalizedTab = tab.parentQueryTabId ? { ...tab, parentQueryTabId: undefined } : tab
    if (normalizedTab !== tab) {
      changed = true
    }

    const identityKey = getTableDataIdentityKey(normalizedTab)
    const existingTabId = standaloneTableTabIdsByKey.get(identityKey)
    if (existingTabId) {
      changed = true
      removedTableTabIds.push(normalizedTab.id)
      remappedTableTabIds.set(normalizedTab.id, existingTabId)
      continue
    }

    standaloneTableTabIdsByKey.set(identityKey, normalizedTab.id)
    normalizedTabs.push(normalizedTab)
  }

  return {
    tabs: changed ? normalizedTabs : tabs,
    removedTableTabIds,
    remappedTableTabIds,
  }
}

function getScopedTableDataChildren(tabs: WorkspaceTab[], queryTabId: string): TableDataTab[] {
  return tabs.filter(
    (tab): tab is TableDataTab => tab.type === 'table-data' && tab.parentQueryTabId === queryTabId
  )
}

function normalizeWorkspaceActiveTab(
  tabs: WorkspaceTab[],
  activeTabId: string | null
): string | null {
  if (!activeTabId) {
    return tabs.length > 0 ? tabs[0].id : null
  }

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null
  if (activeTab?.type === 'table-data' && activeTab.parentQueryTabId) {
    return tabs.some((tab) => tab.id === activeTab.parentQueryTabId)
      ? activeTab.parentQueryTabId
      : activeTabId
  }

  return activeTabId
}

function getStandaloneTableActivationTarget(
  connectionId: string,
  tabs: WorkspaceTab[],
  activeTabId: string | null,
  remappedTableTabIds: Map<string, string>
): string | null {
  if (!activeTabId) {
    return null
  }

  const remapTableTabId = (tabId: string): string => remappedTableTabIds.get(tabId) ?? tabId
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null

  if (activeTab?.type === 'table-data') {
    return remapTableTabId(activeTab.id)
  }

  if (activeTab?.type !== 'query-editor') {
    return null
  }

  const activeBottomPanelItem = useQueryStore
    .getState()
    .getTabState(activeTab.id).activeBottomPanelItem
  if (activeBottomPanelItem.type !== 'table-data') {
    return null
  }

  const visibleScopedTableTab = tabs.find(
    (tab) =>
      tab.type === 'table-data' &&
      tab.id === activeBottomPanelItem.tabId &&
      tab.parentQueryTabId === activeTab.id &&
      tab.connectionId === connectionId
  )

  if (!visibleScopedTableTab) {
    return null
  }

  return remapTableTabId(visibleScopedTableTab.id)
}

function cleanupRemovedTableTabs(tabIds: string[]) {
  for (const tabId of tabIds) {
    useTableDataStore.getState().cleanupTab(tabId)
    useAiStore.getState().cleanupTab(tabId)
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => ({
  tabsByConnection: {},
  activeTabByConnection: {},
  lastFocusedSurfaceByTab: {},
  blockingNavigationByTab: {},
  pendingCascadeClose: null,

  // ------ openTab (with dedup for object-scoped tabs) ------

  openTab: (tab: OpenableTab) => {
    const { connectionId, databaseName, objectName, type } = tab
    const bottomPanelEnabled = isTableTabsInBottomPanelEnabled()
    const currentTabs = get().tabsByConnection[connectionId] || []
    const normalizedCurrentTabs = bottomPanelEnabled
      ? {
          tabs: currentTabs,
          removedTableTabIds: [],
          remappedTableTabIds: new Map<string, string>(),
        }
      : normalizeScopedTableDataTabs(currentTabs)
    const tabs = normalizedCurrentTabs.tabs
    if (tabs !== currentTabs) {
      set((state) => ({
        tabsByConnection: {
          ...state.tabsByConnection,
          [connectionId]: tabs,
        },
        activeTabByConnection: {
          ...state.activeTabByConnection,
          [connectionId]:
            getStandaloneTableActivationTarget(
              connectionId,
              currentTabs,
              state.activeTabByConnection[connectionId] ?? null,
              normalizedCurrentTabs.remappedTableTabIds
            ) ??
            normalizeWorkspaceActiveTab(tabs, state.activeTabByConnection[connectionId] ?? null),
        },
      }))
      cleanupRemovedTableTabs(normalizedCurrentTabs.removedTableTabIds)
    }

    let parentQueryTabId: string | undefined
    if (type === 'table-data' && bottomPanelEnabled) {
      const activeTabId = get().activeTabByConnection[connectionId] ?? null
      const activeTab = tabs.find((candidate) => candidate.id === activeTabId) ?? null
      if (activeTab?.type === 'query-editor') {
        parentQueryTabId = activeTab.id
      } else {
        parentQueryTabId = get().openQueryTab(connectionId)
      }
    }

    const existing = tabs.find((candidate) => {
      if (!isObjectScopedTab(candidate)) return false
      if (
        candidate.databaseName !== databaseName ||
        candidate.objectName !== objectName ||
        candidate.type !== type
      ) {
        return false
      }
      // For object-editor tabs, also match objectType to allow different types with same name
      if (type === 'object-editor' && candidate.type === 'object-editor') {
        return candidate.objectType === (tab as DistributiveOmit<ObjectEditorTab, 'id'>).objectType
      }
      if (type === 'table-data' && candidate.type === 'table-data') {
        return candidate.parentQueryTabId === parentQueryTabId
      }
      return true
    })

    if (existing) {
      set((state) => ({
        activeTabByConnection: {
          ...state.activeTabByConnection,
          [connectionId]:
            existing.type === 'table-data' && existing.parentQueryTabId
              ? existing.parentQueryTabId
              : existing.id,
        },
      }))
      if (existing.type === 'table-data' && existing.parentQueryTabId) {
        useQueryStore.getState().setActiveBottomPanelItem(existing.parentQueryTabId, {
          type: 'table-data',
          tabId: existing.id,
        })
      }
      return
    }

    const newTab: WorkspaceTab = {
      ...tab,
      ...(type === 'table-data' && parentQueryTabId ? { parentQueryTabId } : {}),
      id: generateTabId(),
    } as WorkspaceTab
    set((state) => ({
      tabsByConnection: {
        ...state.tabsByConnection,
        [connectionId]: [...(state.tabsByConnection[connectionId] || []), newTab],
      },
      activeTabByConnection: {
        ...state.activeTabByConnection,
        [connectionId]:
          newTab.type === 'table-data' && newTab.parentQueryTabId
            ? newTab.parentQueryTabId
            : newTab.id,
      },
    }))
    if (newTab.type === 'table-data' && newTab.parentQueryTabId) {
      useQueryStore
        .getState()
        .setActiveBottomPanelItem(newTab.parentQueryTabId, { type: 'table-data', tabId: newTab.id })
    }
  },

  restoreTableDataTab: (tab: Omit<TableDataTab, 'id'>) => {
    const existingStandaloneTab =
      tab.parentQueryTabId === undefined
        ? (get().tabsByConnection[tab.connectionId] ?? []).find(
            (candidate): candidate is TableDataTab =>
              candidate.type === 'table-data' &&
              candidate.parentQueryTabId === undefined &&
              candidate.databaseName === tab.databaseName &&
              candidate.objectName === tab.objectName
          )
        : undefined

    if (existingStandaloneTab) {
      return existingStandaloneTab.id
    }

    const newTab: TableDataTab = { ...tab, id: generateTabId() }
    set((state) => {
      const nextTabs = [...(state.tabsByConnection[tab.connectionId] || []), newTab]
      return {
        tabsByConnection: {
          ...state.tabsByConnection,
          [tab.connectionId]: nextTabs,
        },
        activeTabByConnection: {
          ...state.activeTabByConnection,
          [tab.connectionId]: normalizeWorkspaceActiveTab(
            nextTabs,
            state.activeTabByConnection[tab.connectionId] ?? null
          ),
        },
      }
    })
    return newTab.id
  },

  normalizeTableDataTabScopes: () => {
    set((state) => {
      let changed = false
      const nextTabsByConnection = Object.fromEntries(
        Object.entries(state.tabsByConnection).map(([connectionId, tabs]) => {
          const normalized = normalizeScopedTableDataTabs(tabs)
          if (normalized.tabs !== tabs) {
            changed = true
          }
          return [connectionId, normalized]
        })
      )

      if (!changed) {
        return state
      }

      const nextActiveTabByConnection = Object.fromEntries(
        Object.entries(nextTabsByConnection).map(([connectionId, normalized]) => {
          const currentTabs = state.tabsByConnection[connectionId] ?? []
          const preferredTableTabId = getStandaloneTableActivationTarget(
            connectionId,
            currentTabs,
            state.activeTabByConnection[connectionId] ?? null,
            normalized.remappedTableTabIds
          )

          return [
            connectionId,
            preferredTableTabId ??
              normalizeWorkspaceActiveTab(
                normalized.tabs,
                state.activeTabByConnection[connectionId] ?? null
              ),
          ]
        })
      )

      Object.values(nextTabsByConnection).forEach((normalized) => {
        cleanupRemovedTableTabs(normalized.removedTableTabIds)
      })

      return {
        tabsByConnection: Object.fromEntries(
          Object.entries(nextTabsByConnection).map(([connectionId, normalized]) => [
            connectionId,
            normalized.tabs,
          ])
        ),
        activeTabByConnection: nextActiveTabByConnection,
      }
    })
  },

  // ------ openQueryTab (always creates new tab, no dedup) ------

  openQueryTab: (connectionId: string, label?: string) => {
    const tabNumber = ++queryTabCounter
    const newTab: WorkspaceTab = {
      id: generateTabId(),
      type: 'query-editor',
      label: label ?? `Query ${tabNumber}`,
      connectionId,
    }
    set((state) => ({
      tabsByConnection: {
        ...state.tabsByConnection,
        [connectionId]: [...(state.tabsByConnection[connectionId] || []), newTab],
      },
      activeTabByConnection: {
        ...state.activeTabByConnection,
        [connectionId]: newTab.id,
      },
    }))
    return newTab.id
  },

  // ------ openHistoryTab (singleton per connection) ------

  openHistoryTab: (connectionId: string, activate: boolean = true) => {
    const tabs = get().tabsByConnection[connectionId] || []

    // Reuse existing history tab if one exists
    const existing = tabs.find((t) => t.type === 'history')
    if (existing) {
      if (activate) {
        set((state) => ({
          activeTabByConnection: {
            ...state.activeTabByConnection,
            [connectionId]: existing.id,
          },
        }))
      }
      return
    }

    const newTab: HistoryTab = {
      id: generateTabId(),
      type: 'history',
      label: 'History',
      connectionId,
    }
    set((state) => ({
      tabsByConnection: {
        ...state.tabsByConnection,
        [connectionId]: [newTab, ...(state.tabsByConnection[connectionId] || [])],
      },
      ...(activate
        ? {
            activeTabByConnection: {
              ...state.activeTabByConnection,
              [connectionId]: newTab.id,
            },
          }
        : {}),
    }))
  },

  // ------ openProcessListTab (singleton per connection) ------

  openProcessListTab: (connectionId: string) => {
    const tabs = get().tabsByConnection[connectionId] || []

    // Reuse existing processlist tab if one exists
    const existing = tabs.find((t) => t.type === 'processlist')
    if (existing) return

    const newTab: ProcessListTab = {
      id: `processlist-${connectionId}`,
      type: 'processlist',
      label: 'Process List',
      connectionId,
    }

    // Insert after the history tab if present, otherwise at position 0
    const historyIdx = tabs.findIndex((t) => t.type === 'history')
    const insertIdx = historyIdx >= 0 ? historyIdx + 1 : 0
    const newTabs = [...tabs]
    newTabs.splice(insertIdx, 0, newTab)

    set((state) => ({
      tabsByConnection: {
        ...state.tabsByConnection,
        [connectionId]: newTabs,
      },
    }))
  },

  // ------ closeTab ------

  closeTab: (connectionId: string, tabId: string) => {
    const state = get()
    const tabs = state.tabsByConnection[connectionId] || []
    const idx = tabs.findIndex((t) => t.id === tabId)
    if (idx === -1) return

    const closingTab = tabs[idx]

    // History and processlist tabs are not closable
    if (closingTab.type === 'history' || closingTab.type === 'processlist') return

    if (closingTab.type === 'table-data') {
      const tableDataState = useTableDataStore.getState().tabs[tabId]
      if (tableDataState?.editState && tableDataState.editState.modifiedColumns.size > 0) {
        set((s) => ({
          tabsByConnection: {
            ...s.tabsByConnection,
            [connectionId]: (s.tabsByConnection[connectionId] || []).map((t) =>
              t.id === tabId ? { ...t, pendingClose: true } : t
            ),
          },
        }))
        useTableDataStore.getState().requestNavigationAction(tabId, () => {
          get().forceCloseTab(connectionId, tabId)
        })
        return
      }

      useTableDataStore.getState().cleanupTab(tabId)
      useAiStore.getState().cleanupTab(tabId)
    }

    if (closingTab.type === 'table-designer') {
      const designerTabState = useTableDesignerStore.getState().tabs[tabId]
      if (designerTabState?.isDirty) {
        set((s) => ({
          tabsByConnection: {
            ...s.tabsByConnection,
            [connectionId]: (s.tabsByConnection[connectionId] || []).map((t) =>
              t.id === tabId ? { ...t, pendingClose: true } : t
            ),
          },
        }))
        useTableDesignerStore.getState().requestNavigationAction(tabId, () => {
          get().forceCloseTab(connectionId, tabId)
        })
        return
      }

      useTableDesignerStore.getState().cleanupTab(tabId)
      useAiStore.getState().cleanupTab(tabId)
    }

    if (closingTab.type === 'object-editor') {
      if (useObjectEditorStore.getState().isDirty(tabId)) {
        set((s) => ({
          tabsByConnection: {
            ...s.tabsByConnection,
            [connectionId]: (s.tabsByConnection[connectionId] || []).map((t) =>
              t.id === tabId ? { ...t, pendingClose: true } : t
            ),
          },
        }))
        useObjectEditorStore.getState().requestNavigationAction(tabId, () => {
          get().forceCloseTab(connectionId, tabId)
        })
        return
      }

      useObjectEditorStore.getState().cleanupTab(tabId)
      useAiStore.getState().cleanupTab(tabId)
    }

    if (closingTab.type === 'query-editor') {
      const scopedTableTabs = getScopedTableDataChildren(tabs, tabId)
      if (scopedTableTabs.length > 0) {
        const queryTabState = useQueryStore.getState().tabs[tabId]
        const dirtyQueryResultItems =
          queryTabState?.results
            ?.map((result, index) =>
              result.editState && result.editState.modifiedColumns.size > 0
                ? `Result ${index + 1}`
                : null
            )
            .filter((label): label is string => label != null) ?? []
        const dirtyTableDataItems = scopedTableTabs
          .filter((tab) => {
            const tableDataState = useTableDataStore.getState().tabs[tab.id]
            return (tableDataState?.editState?.modifiedColumns.size ?? 0) > 0
          })
          .map((tab) => tab.label)

        const closeScopedChildren = () => {
          for (const childTab of scopedTableTabs) {
            get().forceCloseTab(connectionId, childTab.id)
          }
        }

        if (dirtyQueryResultItems.length > 0 || dirtyTableDataItems.length > 0) {
          const onCancel = () => set({ pendingCascadeClose: null })
          const onConfirm = () => {
            set({ pendingCascadeClose: null })
            closeScopedChildren()
            get().forceCloseTab(connectionId, tabId)
          }
          set({
            pendingCascadeClose: {
              queryTabId: tabId,
              queryResultItems: dirtyQueryResultItems,
              tableDataItems: dirtyTableDataItems,
              onConfirm,
              onCancel,
            },
          })
          return
        }

        closeScopedChildren()
        get().forceCloseTab(connectionId, tabId)
        return
      }

      const queryTabState = useQueryStore.getState().tabs[tabId]
      const hasUnsavedEdits =
        queryTabState?.results?.some((r) => r.editState && r.editState.modifiedColumns.size > 0) ??
        false
      if (hasUnsavedEdits) {
        set((s) => ({
          tabsByConnection: {
            ...s.tabsByConnection,
            [connectionId]: (s.tabsByConnection[connectionId] || []).map((t) =>
              t.id === tabId ? { ...t, pendingClose: true } : t
            ),
          },
        }))

        // Looping close helper: finds the next dirty result, switches to it,
        // and defers close. When no dirty results remain, force-closes the tab.
        const checkAndCloseOrDefer = () => {
          const currentQueryTab = useQueryStore.getState().tabs[tabId]
          if (!currentQueryTab) {
            // Tab state already cleaned up
            get().forceCloseTab(connectionId, tabId)
            return
          }
          const nextDirtyIndex =
            currentQueryTab.results?.findIndex(
              (r) => r.editState && r.editState.modifiedColumns.size > 0
            ) ?? -1

          if (nextDirtyIndex < 0) {
            // No more dirty results — safe to close
            get().forceCloseTab(connectionId, tabId)
            return
          }

          const currentActiveIdx = currentQueryTab.activeResultIndex ?? 0
          if (nextDirtyIndex !== currentActiveIdx) {
            // Switch to the dirty result and set pendingNavigationAction
            useQueryStore.setState((prev) => ({
              tabs: {
                ...prev.tabs,
                [tabId]: {
                  ...(prev.tabs[tabId] ?? {
                    content: '',
                    filePath: null,
                    tabStatus: 'idle' as const,
                    prevTabStatus: 'idle' as const,
                    cursorPosition: null,
                    connectionId: '',
                    results: [],
                    activeResultIndex: 0,
                    activeBottomPanelItem: { type: 'result' },
                    pendingNavigationAction: null,
                    executionStartedAt: null,
                    isCancelling: false,
                    wasCancelled: false,
                  }),
                  activeResultIndex: nextDirtyIndex,
                  pendingNavigationAction: checkAndCloseOrDefer,
                },
              },
            }))
          } else {
            // Dirty result IS the active result — use requestNavigationAction
            useQueryStore.getState().requestNavigationAction(tabId, checkAndCloseOrDefer)
          }
        }

        // Kick off the first iteration
        checkAndCloseOrDefer()
        return
      }
    }

    const remaining = tabs.filter((t) => t.id !== tabId)
    let newActive = state.activeTabByConnection[connectionId]

    if (newActive === tabId) {
      if (remaining.length === 0) {
        newActive = null
      } else if (idx < remaining.length) {
        newActive = remaining[idx].id
      } else {
        newActive = remaining[remaining.length - 1].id
      }
    }

    if (closingTab.type === 'query-editor') {
      useQueryStore.getState().cleanupTab(connectionId, tabId)
      useAiStore.getState().cleanupTab(tabId)
    }

    set((s) => ({
      pendingCascadeClose:
        s.pendingCascadeClose?.queryTabId === tabId ? null : s.pendingCascadeClose,
      tabsByConnection: {
        ...s.tabsByConnection,
        [connectionId]: remaining,
      },
      activeTabByConnection: {
        ...s.activeTabByConnection,
        [connectionId]: normalizeWorkspaceActiveTab(remaining, newActive),
      },
    }))
  },

  // ------ forceCloseTab (removes tab without unsaved-edit checks) ------

  forceCloseTab: (connectionId: string, tabId: string) => {
    const state = get()
    const tabs = state.tabsByConnection[connectionId] || []
    const idx = tabs.findIndex((t) => t.id === tabId)
    if (idx === -1) return

    const closingTab = tabs[idx]

    // History and processlist tabs are not closable
    if (closingTab.type === 'history' || closingTab.type === 'processlist') return

    if (closingTab.type === 'table-data') {
      useTableDataStore.getState().cleanupTab(tabId)
    } else if (closingTab.type === 'query-editor') {
      useQueryStore.getState().cleanupTab(connectionId, tabId)
    } else if (closingTab.type === 'table-designer') {
      useTableDesignerStore.getState().cleanupTab(tabId)
    } else if (closingTab.type === 'object-editor') {
      useObjectEditorStore.getState().cleanupTab(tabId)
    }
    // Always clean up AI state regardless of tab type
    useAiStore.getState().cleanupTab(tabId)

    const remaining = tabs.filter((t) => t.id !== tabId)
    let newActive = state.activeTabByConnection[connectionId]

    if (newActive === tabId) {
      if (remaining.length === 0) {
        newActive = null
      } else if (idx < remaining.length) {
        newActive = remaining[idx].id
      } else {
        newActive = remaining[remaining.length - 1].id
      }
    }

    set((s) => ({
      pendingCascadeClose:
        s.pendingCascadeClose?.queryTabId === tabId ? null : s.pendingCascadeClose,
      tabsByConnection: {
        ...s.tabsByConnection,
        [connectionId]: remaining,
      },
      activeTabByConnection: {
        ...s.activeTabByConnection,
        [connectionId]: normalizeWorkspaceActiveTab(remaining, newActive),
      },
    }))
  },

  // ------ setActiveTab ------

  setActiveTab: (connectionId: string, tabId: string) => {
    set((state) => ({
      activeTabByConnection: {
        ...state.activeTabByConnection,
        [connectionId]: tabId,
      },
    }))
  },

  requestActivateTab: (tabId: string) => {
    const state = get()
    const connectionEntry = Object.entries(state.tabsByConnection).find(([, tabs]) =>
      tabs.some((tab) => tab.id === tabId)
    )
    if (!connectionEntry) return

    const [connectionId] = connectionEntry
    const currentActiveTabId = state.activeTabByConnection[connectionId] ?? null
    if (currentActiveTabId && state.blockingNavigationByTab[currentActiveTabId]) {
      return
    }

    set((s) => ({
      activeTabByConnection: {
        ...s.activeTabByConnection,
        [connectionId]: tabId,
      },
    }))
  },

  setLastFocusedSurface: (tabId: string, surface: WorkspaceFocusSurface) => {
    set((state) => ({
      lastFocusedSurfaceByTab: {
        ...state.lastFocusedSurfaceByTab,
        [tabId]: surface,
      },
    }))
  },

  setBlockingNavigation: (tabId: string, blocking: boolean) => {
    set((state) => ({
      blockingNavigationByTab: {
        ...state.blockingNavigationByTab,
        [tabId]: blocking,
      },
    }))
  },

  renameQueryTab: (connectionId: string, tabId: string, nextLabel: string) => {
    const normalizedLabel = nextLabel.trim()
    if (!normalizedLabel) {
      return
    }

    set((state) =>
      updateConnectionTabs(state, connectionId, (tabs) =>
        tabs.map((tab) => {
          if (tab.id !== tabId || tab.type !== 'query-editor') {
            return tab
          }

          if (tab.label === normalizedLabel) {
            return tab
          }

          return {
            ...tab,
            label: normalizedLabel,
          }
        })
      )
    )
  },

  reorderWorkspaceTab: (connectionId: string, tabId: string, insertIndex: number) => {
    set((state) =>
      updateConnectionTabs(state, connectionId, (tabs) => {
        const sourceTab = tabs.find((tab) => tab.id === tabId)
        if (!sourceTab || isPinnedWorkspaceTab(sourceTab)) {
          return tabs
        }

        const pinnedTabs = tabs.filter(isPinnedWorkspaceTab)
        const movableTabs = tabs.filter((tab) => !isPinnedWorkspaceTab(tab))
        const sourceIndex = movableTabs.findIndex((tab) => tab.id === tabId)
        if (sourceIndex < 0) {
          return tabs
        }

        const maxInsertIndex = movableTabs.length
        const clampedInsertIndex = Math.max(0, Math.min(insertIndex, maxInsertIndex))

        if (isTableTabsInBottomPanelEnabled() && sourceTab.type === 'query-editor') {
          const scopedChildrenByQueryId = movableTabs.reduce<Record<string, TableDataTab[]>>(
            (acc, tab) => {
              if (tab.type === 'table-data' && tab.parentQueryTabId) {
                ;(acc[tab.parentQueryTabId] ??= []).push(tab)
              }
              return acc
            },
            {}
          )

          const groupedMovableTabs = movableTabs.flatMap<WorkspaceTab[]>((tab) => {
            if (tab.type === 'table-data' && tab.parentQueryTabId) {
              return []
            }

            if (tab.type === 'query-editor') {
              return [[tab, ...(scopedChildrenByQueryId[tab.id] ?? [])]]
            }

            return [[tab]]
          })

          const sourceGroupIndex = groupedMovableTabs.findIndex((group) => group[0]?.id === tabId)
          if (sourceGroupIndex < 0) {
            return tabs
          }

          const insertGroupIndex = (() => {
            const seenGroupIds = new Set<string>()
            for (const tab of movableTabs.slice(0, clampedInsertIndex)) {
              seenGroupIds.add(getMovableTabGroupId(tab))
            }
            return seenGroupIds.size
          })()

          const nextGroups = [...groupedMovableTabs]
          const [movedGroup] = nextGroups.splice(sourceGroupIndex, 1)
          const targetGroupIndex =
            insertGroupIndex > sourceGroupIndex ? insertGroupIndex - 1 : insertGroupIndex

          nextGroups.splice(targetGroupIndex, 0, movedGroup)
          return [...pinnedTabs, ...nextGroups.flat()]
        }

        const nextMovableTabs = [...movableTabs]
        const [movedTab] = nextMovableTabs.splice(sourceIndex, 1)
        const targetIndex =
          clampedInsertIndex > sourceIndex ? clampedInsertIndex - 1 : clampedInsertIndex

        nextMovableTabs.splice(targetIndex, 0, movedTab)
        return [...pinnedTabs, ...nextMovableTabs]
      })
    )
  },

  // ------ closeTabsByDatabase ------

  closeTabsByDatabase: (connectionId: string, databaseName: string) => {
    const tabs = get().tabsByConnection[connectionId] || []

    tabs
      .filter((t) => t.type === 'table-data' && t.databaseName === databaseName)
      .forEach((t) => useTableDataStore.getState().cleanupTab(t.id))

    tabs
      .filter((t) => t.type === 'table-designer' && t.databaseName === databaseName)
      .forEach((t) => useTableDesignerStore.getState().cleanupTab(t.id))

    tabs
      .filter((t) => t.type === 'object-editor' && t.databaseName === databaseName)
      .forEach((t) => useObjectEditorStore.getState().cleanupTab(t.id))

    // Clean up AI state for all tabs being closed
    tabs
      .filter((t) => isObjectScopedTab(t) && t.databaseName === databaseName)
      .forEach((t) => useAiStore.getState().cleanupTab(t.id))

    set((state) =>
      updateConnectionTabs(state, connectionId, (allTabs) =>
        allTabs.filter((t) => !isObjectScopedTab(t) || t.databaseName !== databaseName)
      )
    )
  },

  // ------ closeTabsByObject ------

  closeTabsByObject: (
    connectionId: string,
    databaseName: string,
    objectName: string,
    objectType?: EditableObjectType
  ) => {
    const tabs = get().tabsByConnection[connectionId] || []

    // Only clean up table-data and table-designer tabs when no objectType is
    // specified (backward-compatible "close everything for this name" path).
    // When objectType IS provided it is always a non-table type (procedure,
    // function, view, trigger, event) so table-data / table-designer tabs
    // must be left alone — they belong to a table with the same name.
    // EXCEPTION: views open as table-data tabs with objectType 'view', so
    // those must be closed when dropping a view.
    if (!objectType) {
      tabs
        .filter(
          (t) =>
            t.type === 'table-data' &&
            t.databaseName === databaseName &&
            t.objectName === objectName
        )
        .forEach((t) => useTableDataStore.getState().cleanupTab(t.id))

      tabs
        .filter(
          (t) =>
            t.type === 'table-designer' &&
            t.databaseName === databaseName &&
            t.objectName === objectName
        )
        .forEach((t) => useTableDesignerStore.getState().cleanupTab(t.id))
    } else if (objectType === 'view') {
      // Views open as table-data tabs with objectType 'view' — clean those up
      tabs
        .filter(
          (t) =>
            t.type === 'table-data' &&
            t.databaseName === databaseName &&
            t.objectName === objectName &&
            t.objectType === 'view'
        )
        .forEach((t) => useTableDataStore.getState().cleanupTab(t.id))
    }

    // Cleanup object-editor tabs (filtered by objectType if provided)
    tabs
      .filter((t) => {
        if (t.type !== 'object-editor') return false
        if (t.databaseName !== databaseName || t.objectName !== objectName) return false
        if (objectType && t.objectType !== objectType) return false
        return true
      })
      .forEach((t) => useObjectEditorStore.getState().cleanupTab(t.id))

    // Clean up AI state for all tabs that will be removed.
    // Use the same filter logic as the set() call below to identify removed tabs.
    tabs
      .filter((t) => {
        if (!isObjectScopedTab(t)) return false
        if (t.databaseName !== databaseName || t.objectName !== objectName) return false
        if (objectType && (t.type === 'table-data' || t.type === 'table-designer')) {
          if (objectType === 'view' && t.type === 'table-data' && t.objectType === 'view')
            return true
          return false
        }
        if (objectType && t.type === 'object-editor' && t.objectType !== objectType) return false
        if (objectType && t.type === 'schema-info' && t.objectType !== objectType) return false
        return true
      })
      .forEach((t) => useAiStore.getState().cleanupTab(t.id))

    set((state) =>
      updateConnectionTabs(state, connectionId, (allTabs) =>
        allTabs.filter((t) => {
          if (!isObjectScopedTab(t)) return true
          if (t.databaseName !== databaseName || t.objectName !== objectName) return true
          // When objectType is provided, preserve table-data and table-designer
          // tabs — they always belong to tables, not to the non-table object
          // being dropped. EXCEPTION: views open as table-data tabs with
          // objectType 'view', so those must be removed when dropping a view.
          if (objectType && (t.type === 'table-data' || t.type === 'table-designer')) {
            if (objectType === 'view' && t.type === 'table-data' && t.objectType === 'view') {
              return false // remove this view's table-data tab
            }
            return true
          }
          // For object-editor, if objectType filter is provided, only remove matching
          if (objectType && t.type === 'object-editor' && t.objectType !== objectType) return true
          // For schema-info, if objectType filter is provided, only remove matching
          if (objectType && t.type === 'schema-info' && t.objectType !== objectType) return true
          return false
        })
      )
    )
  },

  // ------ updateTabDatabase ------

  updateTabDatabase: (connectionId: string, oldDatabase: string, newDatabase: string) => {
    set((state) =>
      updateConnectionTabs(state, connectionId, (tabs) =>
        tabs.map((t) => {
          if (!isObjectScopedTab(t) || t.databaseName !== oldDatabase) {
            return t
          }

          return {
            ...t,
            databaseName: newDatabase,
            label: getUpdatedObjectTabLabel(t, t.objectName),
          } as WorkspaceTab
        })
      )
    )
  },

  // ------ updateTabObject ------

  updateTabObject: (
    connectionId: string,
    databaseName: string,
    oldObjectName: string,
    newObjectName: string
  ) => {
    set((state) =>
      updateConnectionTabs(state, connectionId, (tabs) =>
        tabs.map((t) => {
          if (
            !isObjectScopedTab(t) ||
            t.databaseName !== databaseName ||
            t.objectName !== oldObjectName
          ) {
            return t
          }

          return {
            ...t,
            objectName: newObjectName,
            label: getUpdatedObjectTabLabel(t, newObjectName),
          } as WorkspaceTab
        })
      )
    )
  },

  updateTableDesignerTab: (tabId, partial) => {
    set((state) => {
      let changed = false

      const nextTabsByConnection = Object.fromEntries(
        Object.entries(state.tabsByConnection).map(([connectionId, tabs]) => [
          connectionId,
          tabs.map((tab) => {
            if (tab.id !== tabId || tab.type !== 'table-designer') {
              return tab
            }

            changed = true
            return {
              ...tab,
              ...partial,
              label:
                partial.objectName !== undefined
                  ? partial.objectName
                  : (partial.label ?? tab.label),
            }
          }),
        ])
      )

      if (!changed) {
        return state
      }

      return {
        tabsByConnection: nextTabsByConnection,
      }
    })
  },

  // ------ updateObjectEditorTab ------

  updateObjectEditorTab: (tabId, partial) => {
    set((state) => {
      let changed = false

      const nextTabsByConnection = Object.fromEntries(
        Object.entries(state.tabsByConnection).map(([connectionId, tabs]) => [
          connectionId,
          tabs.map((tab) => {
            if (tab.id !== tabId || tab.type !== 'object-editor') {
              return tab
            }

            changed = true
            return {
              ...tab,
              ...partial,
              label: partial.label ?? tab.label,
            }
          }),
        ])
      )

      if (!changed) {
        return state
      }

      return {
        tabsByConnection: nextTabsByConnection,
      }
    })
  },

  // ------ setSubTab ------

  setSubTab: (connectionId: string, tabId: string, subTab: WorkspaceTab['subTabId']) => {
    set((state) =>
      updateConnectionTabs(state, connectionId, (tabs) =>
        tabs.map((t) => (t.id === tabId ? { ...t, subTabId: subTab } : t))
      )
    )
  },

  // ------ clearConnectionTabs ------

  clearConnectionTabs: (connectionId: string) => {
    const state = get()
    const tabs = state.tabsByConnection[connectionId] || []

    const queryTabIds = tabs.filter((t) => t.type === 'query-editor').map((t) => t.id)
    if (queryTabIds.length > 0) {
      useQueryStore.getState().cleanupConnection(connectionId, queryTabIds)
    }

    tabs
      .filter((t) => t.type === 'table-data')
      .forEach((t) => useTableDataStore.getState().cleanupTab(t.id))

    tabs
      .filter((t) => t.type === 'table-designer')
      .forEach((t) => useTableDesignerStore.getState().cleanupTab(t.id))

    tabs
      .filter((t) => t.type === 'object-editor')
      .forEach((t) => useObjectEditorStore.getState().cleanupTab(t.id))

    // Clean up AI state for all tabs being removed
    tabs.forEach((t) => useAiStore.getState().cleanupTab(t.id))

    set((s) => {
      const newTabs = { ...s.tabsByConnection }
      const newActive = { ...s.activeTabByConnection }
      delete newTabs[connectionId]
      delete newActive[connectionId]
      return { tabsByConnection: newTabs, activeTabByConnection: newActive }
    })
  },
}))

let previousTableTabsInBottomPanelSetting = useSettingsStore
  .getState()
  .getSetting('results.tableTabsInBottomPanel')

useSettingsStore.subscribe((state) => {
  const nextSetting = state.getSetting('results.tableTabsInBottomPanel')
  if (previousTableTabsInBottomPanelSetting === 'true' && nextSetting === 'false') {
    useWorkspaceStore.getState().normalizeTableDataTabScopes()
  }
  previousTableTabsInBottomPanelSetting = nextSetting
})
