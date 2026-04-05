import { create } from 'zustand'
import type {
  WorkspaceTab,
  SchemaInfoTab,
  TableDataTab,
  TableDesignerTab,
  ObjectEditorTab,
  EditableObjectType,
  DistributiveOmit,
} from '../types/schema'
import { useQueryStore } from './query-store'
import { useTableDataStore } from './table-data-store'
import { useTableDesignerStore } from './table-designer-store'
import { useObjectEditorStore } from './object-editor-store'

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

  // Actions
  openTab: (tab: OpenableTab) => void
  openQueryTab: (connectionId: string, label?: string) => string
  closeTab: (connectionId: string, tabId: string) => void
  forceCloseTab: (connectionId: string, tabId: string) => void
  setActiveTab: (connectionId: string, tabId: string) => void
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
  objectName: string = tab.objectName,
  databaseName: string = tab.databaseName
): string {
  if (tab.type === 'table-designer') {
    return objectName
  }

  if (tab.type === 'object-editor') {
    return getObjectEditorLabel(tab.objectType, objectName)
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
      return true
    })

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
    } else if (closingTab.type === 'object-editor') {
      useObjectEditorStore.getState().cleanupTab(tabId)
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

    tabs
      .filter((t) => t.type === 'object-editor' && t.databaseName === databaseName)
      .forEach((t) => useObjectEditorStore.getState().cleanupTab(t.id))

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

    set((state) =>
      updateConnectionTabs(state, connectionId, (allTabs) =>
        allTabs.filter((t) => {
          if (!isObjectScopedTab(t)) return true
          if (t.databaseName !== databaseName || t.objectName !== objectName) return true
          // When objectType is provided, preserve table-data and table-designer
          // tabs — they always belong to tables, not to the non-table object
          // being dropped.
          if (objectType && (t.type === 'table-data' || t.type === 'table-designer')) return true
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

    set((s) => {
      const newTabs = { ...s.tabsByConnection }
      const newActive = { ...s.activeTabByConnection }
      delete newTabs[connectionId]
      delete newActive[connectionId]
      return { tabsByConnection: newTabs, activeTabByConnection: newActive }
    })
  },
}))
