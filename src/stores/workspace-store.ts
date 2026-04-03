import { create } from 'zustand'
import type {
  WorkspaceTab,
  SchemaInfoTab,
  TableDataTab,
  TableDesignerTab,
  DistributiveOmit,
} from '../types/schema'
import { useQueryStore } from './query-store'
import { useTableDataStore } from './table-data-store'
import { useTableDesignerStore } from './table-designer-store'

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

type ObjectScopedTab = SchemaInfoTab | TableDataTab | TableDesignerTab

/** The tab types that openTab accepts. */
type OpenableTab = DistributiveOmit<ObjectScopedTab, 'id'>

interface WorkspaceState {
  /** Tabs per connection ID. */
  tabsByConnection: Record<string, WorkspaceTab[]>

  /** Active tab ID per connection. */
  activeTabByConnection: Record<string, string | null>

  // Actions
  openTab: (tab: OpenableTab) => void
  openQueryTab: (connectionId: string, label?: string) => string
  closeTab: (connectionId: string, tabId: string) => void
  forceCloseTab: (connectionId: string, tabId: string) => void
  setActiveTab: (connectionId: string, tabId: string) => void
  closeTabsByDatabase: (connectionId: string, databaseName: string) => void
  closeTabsByObject: (connectionId: string, databaseName: string, objectName: string) => void
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
  setSubTab: (connectionId: string, tabId: string, subTab: WorkspaceTab['subTabId']) => void
  clearConnectionTabs: (connectionId: string) => void
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isObjectScopedTab(tab: WorkspaceTab): tab is ObjectScopedTab {
  return tab.type === 'schema-info' || tab.type === 'table-data' || tab.type === 'table-designer'
}

function getUpdatedObjectTabLabel(
  tab: ObjectScopedTab,
  objectName: string = tab.objectName,
  databaseName: string = tab.databaseName
): string {
  if (tab.type === 'table-designer') {
    return objectName
  }

  return `${databaseName}.${objectName}`
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

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => ({
  tabsByConnection: {},
  activeTabByConnection: {},

  // ------ openTab (with dedup for object-scoped tabs) ------

  openTab: (tab: OpenableTab) => {
    const { connectionId, databaseName, objectName, type } = tab
    const tabs = get().tabsByConnection[connectionId] || []

    const existing = tabs.find(
      (candidate) =>
        isObjectScopedTab(candidate) &&
        candidate.databaseName === databaseName &&
        candidate.objectName === objectName &&
        candidate.type === type
    )

    if (existing) {
      set((state) => ({
        activeTabByConnection: {
          ...state.activeTabByConnection,
          [connectionId]: existing.id,
        },
      }))
      return
    }

    const newTab: WorkspaceTab = { ...tab, id: generateTabId() } as WorkspaceTab
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

  // ------ closeTab ------

  closeTab: (connectionId: string, tabId: string) => {
    const state = get()
    const tabs = state.tabsByConnection[connectionId] || []
    const idx = tabs.findIndex((t) => t.id === tabId)
    if (idx === -1) return

    const closingTab = tabs[idx]

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
    }

    if (closingTab.type === 'query-editor') {
      const queryTabState = useQueryStore.getState().tabs[tabId]
      if (queryTabState?.editState && queryTabState.editState.modifiedColumns.size > 0) {
        set((s) => ({
          tabsByConnection: {
            ...s.tabsByConnection,
            [connectionId]: (s.tabsByConnection[connectionId] || []).map((t) =>
              t.id === tabId ? { ...t, pendingClose: true } : t
            ),
          },
        }))
        useQueryStore.getState().requestNavigationAction(tabId, () => {
          get().forceCloseTab(connectionId, tabId)
        })
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
    }

    set((s) => ({
      tabsByConnection: {
        ...s.tabsByConnection,
        [connectionId]: remaining,
      },
      activeTabByConnection: {
        ...s.activeTabByConnection,
        [connectionId]: newActive,
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

    if (closingTab.type === 'table-data') {
      useTableDataStore.getState().cleanupTab(tabId)
    } else if (closingTab.type === 'query-editor') {
      useQueryStore.getState().cleanupTab(connectionId, tabId)
    } else if (closingTab.type === 'table-designer') {
      useTableDesignerStore.getState().cleanupTab(tabId)
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

    set((s) => ({
      tabsByConnection: {
        ...s.tabsByConnection,
        [connectionId]: remaining,
      },
      activeTabByConnection: {
        ...s.activeTabByConnection,
        [connectionId]: newActive,
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

  // ------ closeTabsByDatabase ------

  closeTabsByDatabase: (connectionId: string, databaseName: string) => {
    const tabs = get().tabsByConnection[connectionId] || []

    tabs
      .filter((t) => t.type === 'table-data' && t.databaseName === databaseName)
      .forEach((t) => useTableDataStore.getState().cleanupTab(t.id))

    tabs
      .filter((t) => t.type === 'table-designer' && t.databaseName === databaseName)
      .forEach((t) => useTableDesignerStore.getState().cleanupTab(t.id))

    set((state) =>
      updateConnectionTabs(state, connectionId, (allTabs) =>
        allTabs.filter((t) => !isObjectScopedTab(t) || t.databaseName !== databaseName)
      )
    )
  },

  // ------ closeTabsByObject ------

  closeTabsByObject: (connectionId: string, databaseName: string, objectName: string) => {
    const tabs = get().tabsByConnection[connectionId] || []

    tabs
      .filter(
        (t) =>
          t.type === 'table-data' && t.databaseName === databaseName && t.objectName === objectName
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

    set((state) =>
      updateConnectionTabs(state, connectionId, (allTabs) =>
        allTabs.filter(
          (t) =>
            !isObjectScopedTab(t) ||
            !(t.databaseName === databaseName && t.objectName === objectName)
        )
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
            label: getUpdatedObjectTabLabel(t, t.objectName, newDatabase),
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

    set((s) => {
      const newTabs = { ...s.tabsByConnection }
      const newActive = { ...s.activeTabByConnection }
      delete newTabs[connectionId]
      delete newActive[connectionId]
      return { tabsByConnection: newTabs, activeTabByConnection: newActive }
    })
  },
}))
