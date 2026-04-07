/**
 * Session restore store — saves workspace state on app close and restores it on relaunch.
 *
 * Session restore is DEFAULT ON (`session.restore` = `"true"`).
 * State is stored as JSON in the `session.state` settings key.
 */

import { create } from 'zustand'
import { useSettingsStore } from './settings-store'
import { useConnectionStore } from './connection-store'
import { useWorkspaceStore } from './workspace-store'
import { useQueryStore } from './query-store'
import { showErrorToast } from './toast-store'
import type {
  SessionState,
  SessionConnectionState,
  SessionTabState,
} from '../lib/session-restore-commands'
import { saveSessionState, loadSessionState } from '../lib/session-restore-commands'
import type { WorkspaceTab } from '../types/schema'

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface SessionRestoreState {
  /** True while restoring session on app launch. */
  isRestoring: boolean
  /** Error message if restore failed. */
  restoreError: string | null

  // Actions
  saveSession: () => Promise<void>
  restoreSession: () => Promise<void>
  isEnabled: () => boolean
}

export const useSessionRestoreStore = create<SessionRestoreState>()((set, get) => ({
  isRestoring: false,
  restoreError: null,

  isEnabled: (): boolean => {
    return useSettingsStore.getState().getSetting('session.restore') === 'true'
  },

  saveSession: async (): Promise<void> => {
    if (!get().isEnabled()) {
      return
    }

    try {
      const state = buildSessionState()
      await saveSessionState(state)
    } catch (e) {
      console.error('[session-restore] Failed to save session state:', e)
    }
  },

  restoreSession: async (): Promise<void> => {
    // Guard against concurrent calls (React StrictMode double-invokes effects
    // in dev, which would otherwise open each connection twice).
    if (get().isRestoring) {
      return
    }

    if (!get().isEnabled()) {
      return
    }

    set({ isRestoring: true, restoreError: null })

    try {
      const state = await loadSessionState()
      if (!state || state.connections.length === 0) {
        set({ isRestoring: false })
        return
      }

      // Ensure saved connections are loaded so we can look them up by profile ID
      await useConnectionStore.getState().fetchSavedConnections()

      for (const connState of state.connections) {
        try {
          const sessionId = await connectByProfileId(connState.profileId)
          if (!sessionId) {
            continue
          }

          // Restore tabs for this connection
          await restoreConnectionTabs(sessionId, connState)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          console.error(
            `[session-restore] Failed to restore connection ${connState.profileId}:`,
            msg
          )
          showErrorToast('Session restore failed', `Could not reconnect: ${msg}`)
        }
      }

      set({ isRestoring: false })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[session-restore] Failed to restore session:', msg)
      set({ isRestoring: false, restoreError: msg })
      showErrorToast('Session restore failed', msg)
    }
  },
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the session state snapshot from the current stores.
 */
function buildSessionState(): SessionState {
  const connectionStore = useConnectionStore.getState()
  const workspaceStore = useWorkspaceStore.getState()
  const queryStore = useQueryStore.getState()

  const connections: SessionConnectionState[] = []

  for (const [sessionId, active] of Object.entries(connectionStore.activeConnections)) {
    const profileId = active.profile.id
    const tabs = workspaceStore.tabsByConnection[sessionId] ?? []
    const activeTabId = workspaceStore.activeTabByConnection[sessionId] ?? null

    const serializedTabs: SessionTabState[] = []
    let activeTabIndex = 0

    for (const tab of tabs) {
      const serialized = serializeTab(tab, queryStore)
      if (serialized) {
        serializedTabs.push(serialized)
      }
    }

    // Find the active tab index in the serialized list
    if (activeTabId) {
      const idx = serializedTabs.findIndex((st) => st.tabId === activeTabId)
      if (idx >= 0) {
        activeTabIndex = idx
      }
    }

    connections.push({
      profileId,
      activeTabIndex,
      tabs: serializedTabs,
    })
  }

  return { version: 1, connections }
}

/**
 * Serialize a workspace tab to a session tab state.
 * Returns null for tab types that should not be serialized (table-designer, object-editor).
 */
function serializeTab(
  tab: WorkspaceTab,
  queryStore: ReturnType<(typeof useQueryStore)['getState']>
): SessionTabState | null {
  switch (tab.type) {
    case 'query-editor': {
      const tabState = queryStore.tabs[tab.id]
      return {
        type: 'query-editor',
        tabId: tab.id,
        sql: tabState?.content ?? '',
        cursorLine: tabState?.cursorPosition?.lineNumber,
        cursorColumn: tabState?.cursorPosition?.column,
        label: tab.label,
      }
    }
    case 'table-data':
      return {
        type: 'table-data',
        tabId: tab.id,
        databaseName: tab.databaseName,
        tableName: tab.objectName,
      }
    case 'schema-info':
      return {
        type: 'schema-info',
        tabId: tab.id,
        databaseName: tab.databaseName,
        objectName: tab.objectName,
        objectType: tab.objectType,
      }
    case 'history':
      return {
        type: 'history',
        tabId: tab.id,
      }
    // table-designer and object-editor are NOT serialized
    case 'table-designer':
    case 'object-editor':
      return null
    default:
      return null
  }
}

/**
 * Connect using a saved profile ID.
 * Finds the new runtime session ID by comparing activeConnections before/after.
 * Returns the session ID or null if the connection failed.
 */
async function connectByProfileId(profileId: string): Promise<string | null> {
  const store = useConnectionStore.getState()

  // Check if the profile exists in saved connections
  const profile = store.savedConnections.find((c) => c.id === profileId)
  if (!profile) {
    console.warn(`[session-restore] Profile ${profileId} not found in saved connections, skipping`)
    return null
  }

  // Record existing session IDs before connecting
  const existingSessionIds = new Set(Object.keys(store.activeConnections))

  try {
    await store.openConnection(profileId)
  } catch {
    // openConnection already shows error toast
    return null
  }

  // Find the new session ID by diffing
  const updatedStore = useConnectionStore.getState()
  for (const sessionId of Object.keys(updatedStore.activeConnections)) {
    if (!existingSessionIds.has(sessionId)) {
      return sessionId
    }
  }

  // Shouldn't happen, but guard against it
  console.warn(`[session-restore] Could not find new session ID for profile ${profileId}`)
  return null
}

/**
 * Restore tabs for a given connection session.
 */
async function restoreConnectionTabs(
  sessionId: string,
  connState: SessionConnectionState
): Promise<void> {
  const workspaceStore = useWorkspaceStore.getState()
  const queryStore = useQueryStore.getState()
  let activeTabId: string | null = null

  for (let i = 0; i < connState.tabs.length; i++) {
    const tabState = connState.tabs[i]
    let restoredTabId: string | null = null

    switch (tabState.type) {
      case 'query-editor': {
        const tabId = workspaceStore.openQueryTab(sessionId, tabState.label)
        restoredTabId = tabId

        // Set the SQL content and cursor position
        if (tabState.sql) {
          queryStore.setContent(tabId, tabState.sql)
        }
        if (tabState.cursorLine != null && tabState.cursorColumn != null) {
          queryStore.setCursorPosition(tabId, {
            lineNumber: tabState.cursorLine,
            column: tabState.cursorColumn,
          })
        }
        break
      }
      case 'table-data': {
        workspaceStore.openTab({
          type: 'table-data',
          label: `${tabState.databaseName}.${tabState.tableName}`,
          connectionId: sessionId,
          databaseName: tabState.databaseName,
          objectName: tabState.tableName,
          objectType: 'table',
        })
        // Find the tab that was just created (last one with matching props)
        const allTabs = useWorkspaceStore.getState().tabsByConnection[sessionId] ?? []
        const created = allTabs.find(
          (t) =>
            t.type === 'table-data' &&
            t.databaseName === tabState.databaseName &&
            t.objectName === tabState.tableName
        )
        restoredTabId = created?.id ?? null
        break
      }
      case 'schema-info': {
        workspaceStore.openTab({
          type: 'schema-info',
          label: `${tabState.databaseName}.${tabState.objectName}`,
          connectionId: sessionId,
          databaseName: tabState.databaseName,
          objectName: tabState.objectName,
          objectType: tabState.objectType as
            | 'table'
            | 'view'
            | 'procedure'
            | 'function'
            | 'trigger'
            | 'event',
        })
        const allTabs = useWorkspaceStore.getState().tabsByConnection[sessionId] ?? []
        const created = allTabs.find(
          (t) =>
            t.type === 'schema-info' &&
            t.databaseName === tabState.databaseName &&
            t.objectName === tabState.objectName
        )
        restoredTabId = created?.id ?? null
        break
      }
      case 'history': {
        workspaceStore.openHistoryTab(sessionId)
        const allTabs = useWorkspaceStore.getState().tabsByConnection[sessionId] ?? []
        const created = allTabs.find((t) => t.type === 'history')
        restoredTabId = created?.id ?? null
        break
      }
    }

    // Track the tab that should be active
    if (i === connState.activeTabIndex && restoredTabId) {
      activeTabId = restoredTabId
    }
  }

  // Set the correct active tab
  if (activeTabId) {
    useWorkspaceStore.getState().setActiveTab(sessionId, activeTabId)
  }
}

// ---------------------------------------------------------------------------
// Close handler registration
// ---------------------------------------------------------------------------

/** Tauri's window APIs require injected internals; absent in jsdom / Vitest / plain Vite. */
function canUseTauriWindow(): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  return (
    '__TAURI_INTERNALS__' in window &&
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ != null
  )
}

/**
 * Register the window close handler that saves session state before exiting.
 * Must be called after settings are loaded.
 *
 * Uses dynamic import of `@tauri-apps/api/window` to avoid issues in
 * environments without Tauri internals (Vitest, plain Vite).
 */
export async function registerCloseHandler(): Promise<void> {
  if (!canUseTauriWindow()) {
    return
  }

  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const appWindow = getCurrentWindow()

    await appWindow.onCloseRequested(async (event) => {
      event.preventDefault()
      try {
        await useSessionRestoreStore.getState().saveSession()
      } catch (e) {
        console.error('[session-restore] Error saving session on close:', e)
      }
      await appWindow.destroy()
    })
  } catch (e) {
    console.warn('[session-restore] Failed to register close handler:', e)
  }
}
