import { create } from 'zustand'
import type { WorkspaceTab } from '../types/schema'

// ---------------------------------------------------------------------------
// Tab ID generation
// ---------------------------------------------------------------------------

let tabIdCounter = 0

/** Reset the counter — for testing only. */
export function _resetTabIdCounter() {
  tabIdCounter = 0
}

function generateTabId(): string {
  return `tab-${++tabIdCounter}`
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

interface WorkspaceState {
  /** Tabs per connection ID. */
  tabsByConnection: Record<string, WorkspaceTab[]>

  /** Active tab ID per connection. */
  activeTabByConnection: Record<string, string | null>

  // Actions
  openTab: (tab: Omit<WorkspaceTab, 'id'>) => void
  closeTab: (connectionId: string, tabId: string) => void
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
// Internal helpers (Simplification 7)
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

  // ------ openTab ------

  openTab: (tab: Omit<WorkspaceTab, 'id'>) => {
    const { connectionId, databaseName, objectName, type } = tab
    const tabs = get().tabsByConnection[connectionId] || []

    // Dedup: if a tab with same connection + database + object + type exists, focus it
    const existing = tabs.find(
      (t) => t.databaseName === databaseName && t.objectName === objectName && t.type === type
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
    const newTab: WorkspaceTab = { ...tab, id: generateTabId() }
    set((state) => ({
      tabsByConnection: {
        ...state.tabsByConnection,
        [connectionId]: [...tabs, newTab],
      },
      activeTabByConnection: {
        ...state.activeTabByConnection,
        [connectionId]: newTab.id,
      },
    }))
  },

  // ------ closeTab ------

  closeTab: (connectionId: string, tabId: string) => {
    const state = get()
    const tabs = state.tabsByConnection[connectionId] || []
    const idx = tabs.findIndex((t) => t.id === tabId)
    if (idx === -1) return

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
    set((state) =>
      updateConnectionTabs(state, connectionId, (tabs) =>
        tabs.filter((t) => t.databaseName !== databaseName)
      )
    )
  },

  // ------ closeTabsByObject ------

  closeTabsByObject: (connectionId: string, databaseName: string, objectName: string) => {
    set((state) =>
      updateConnectionTabs(state, connectionId, (tabs) =>
        tabs.filter((t) => !(t.databaseName === databaseName && t.objectName === objectName))
      )
    )
  },

  // ------ updateTabDatabase ------

  updateTabDatabase: (connectionId: string, oldDatabase: string, newDatabase: string) => {
    set((state) =>
      updateConnectionTabs(state, connectionId, (tabs) =>
        tabs.map((t) =>
          t.databaseName === oldDatabase
            ? {
                ...t,
                databaseName: newDatabase,
                label: `${newDatabase}.${t.objectName}`,
              }
            : t
        )
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
        tabs.map((t) =>
          t.databaseName === databaseName && t.objectName === oldObjectName
            ? {
                ...t,
                objectName: newObjectName,
                label: `${t.databaseName}.${newObjectName}`,
              }
            : t
        )
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
    set((state) => {
      const newTabs = { ...state.tabsByConnection }
      const newActive = { ...state.activeTabByConnection }
      delete newTabs[connectionId]
      delete newActive[connectionId]
      return { tabsByConnection: newTabs, activeTabByConnection: newActive }
    })
  },
}))
