import { create } from 'zustand'
import type { WorkspaceTab, SchemaInfoTab, TableDataTab, DistributiveOmit } from '../types/schema'
import { useQueryStore } from './query-store'
import { useTableDataStore } from './table-data-store'

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

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

/** The tab types that openTab accepts (schema-info and table-data only). */
type OpenableTab = DistributiveOmit<SchemaInfoTab | TableDataTab, 'id'>

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
  setSubTab: (connectionId: string, tabId: string, subTab: WorkspaceTab['subTabId']) => void
  clearConnectionTabs: (connectionId: string) => void
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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

  // ------ openTab (schema-info and table-data only, with dedup) ------

  openTab: (tab: OpenableTab) => {
    const { connectionId, databaseName, objectName, type } = tab
    const tabs = get().tabsByConnection[connectionId] || []

    // Dedup: if a tab with same connection + database + object + type exists, focus it
    const existing = tabs.find(
      (t) =>
        t.type !== 'query-editor' &&
        (t as SchemaInfoTab | TableDataTab).databaseName === databaseName &&
        (t as SchemaInfoTab | TableDataTab).objectName === objectName &&
        t.type === type
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

    // Create new tab
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

    // Handle table-data tabs: check for unsaved edits before closing
    if (closingTab.type === 'table-data') {
      const tableDataState = useTableDataStore.getState().tabs[tabId]
      if (tableDataState?.editState && tableDataState.editState.modifiedColumns.size > 0) {
        // Defer close — mark tab as pending and prompt user
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
      // No unsaved edits — clean up and proceed
      useTableDataStore.getState().cleanupTab(tabId)
    }

    // Handle query-editor tabs: check for unsaved result edits before closing
    if (closingTab.type === 'query-editor') {
      const queryTabState = useQueryStore.getState().tabs[tabId]
      if (queryTabState?.editState && queryTabState.editState.modifiedColumns.size > 0) {
        // Defer close — mark tab as pending and prompt user
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

    // If closing the active tab, pick an adjacent one
    if (newActive === tabId) {
      if (remaining.length === 0) {
        newActive = null
      } else if (idx < remaining.length) {
        newActive = remaining[idx].id
      } else {
        newActive = remaining[remaining.length - 1].id
      }
    }

    // Clean up query store state for query-editor tabs
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

    // Clean up associated stores
    if (closingTab.type === 'table-data') {
      useTableDataStore.getState().cleanupTab(tabId)
    } else if (closingTab.type === 'query-editor') {
      useQueryStore.getState().cleanupTab(connectionId, tabId)
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

    // Clean up table-data store state for tabs being closed
    tabs
      .filter((t) => t.type === 'table-data' && (t as TableDataTab).databaseName === databaseName)
      .forEach((t) => useTableDataStore.getState().cleanupTab(t.id))

    set((state) =>
      updateConnectionTabs(state, connectionId, (allTabs) =>
        allTabs.filter((t) => {
          if (t.type === 'query-editor') return true // skip query tabs
          return (t as SchemaInfoTab | TableDataTab).databaseName !== databaseName
        })
      )
    )
  },

  // ------ closeTabsByObject ------

  closeTabsByObject: (connectionId: string, databaseName: string, objectName: string) => {
    const tabs = get().tabsByConnection[connectionId] || []

    // Clean up table-data store state for tabs being closed
    tabs
      .filter((t) => {
        if (t.type !== 'table-data') return false
        const dt = t as TableDataTab
        return dt.databaseName === databaseName && dt.objectName === objectName
      })
      .forEach((t) => useTableDataStore.getState().cleanupTab(t.id))

    set((state) =>
      updateConnectionTabs(state, connectionId, (allTabs) =>
        allTabs.filter((t) => {
          if (t.type === 'query-editor') return true // skip query tabs
          const dt = t as SchemaInfoTab | TableDataTab
          return !(dt.databaseName === databaseName && dt.objectName === objectName)
        })
      )
    )
  },

  // ------ updateTabDatabase ------

  updateTabDatabase: (connectionId: string, oldDatabase: string, newDatabase: string) => {
    set((state) =>
      updateConnectionTabs(state, connectionId, (tabs) =>
        tabs.map((t) => {
          if (t.type === 'query-editor') return t // skip query tabs
          const dt = t as SchemaInfoTab | TableDataTab
          if (dt.databaseName !== oldDatabase) return t
          return {
            ...dt,
            databaseName: newDatabase,
            label: `${newDatabase}.${dt.objectName}`,
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
          if (t.type === 'query-editor') return t // skip query tabs
          const dt = t as SchemaInfoTab | TableDataTab
          if (dt.databaseName !== databaseName || dt.objectName !== oldObjectName) return t
          return {
            ...dt,
            objectName: newObjectName,
            label: `${dt.databaseName}.${newObjectName}`,
          } as WorkspaceTab
        })
      )
    )
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

    // Clean up query-editor tabs
    const queryTabIds = tabs.filter((t) => t.type === 'query-editor').map((t) => t.id)
    if (queryTabIds.length > 0) {
      useQueryStore.getState().cleanupConnection(connectionId, queryTabIds)
    }

    // Clean up table-data tabs
    tabs
      .filter((t) => t.type === 'table-data')
      .forEach((t) => useTableDataStore.getState().cleanupTab(t.id))

    set((s) => {
      const newTabs = { ...s.tabsByConnection }
      const newActive = { ...s.activeTabByConnection }
      delete newTabs[connectionId]
      delete newActive[connectionId]
      return { tabsByConnection: newTabs, activeTabByConnection: newActive }
    })
  },
}))
