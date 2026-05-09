/**
 * Session restore store — saves workspace state on app close and restores it on relaunch.
 *
 * Session restore is DEFAULT ON (`session.restore` = `"true"`).
 * State is stored as JSON in the `session.state` settings key.
 */

import { create } from 'zustand'
import { useSettingsStore } from './settings-store'
import { normalizeActiveConnectionOrder, useConnectionStore } from './connection-store'
import { useWorkspaceStore } from './workspace-store'
import { useQueryStore } from './query-store'
import { showErrorToast } from './toast-store'
import { logFrontend } from '../lib/app-log-commands'
import type {
  SessionState,
  SessionConnectionState,
  SessionTabState,
} from '../lib/session-restore-commands'
import { saveSessionState, loadSessionState } from '../lib/session-restore-commands'
import { hasTauriApis } from '../lib/tauri-env'
import type { WorkspaceTab } from '../types/schema'

export const SESSION_AUTOSAVE_INTERVAL_MS = 5 * 60 * 1000

interface CloseRequestedEvent {
  preventDefault: () => void
}

interface SessionPersistenceWindow {
  onCloseRequested: (
    handler: (event: CloseRequestedEvent) => Promise<void> | void
  ) => Promise<unknown>
  destroy: () => Promise<void>
}

interface SaveSessionOptions {
  throwOnError?: boolean
}

type LoadTauriWindowApi = () => Promise<{ getCurrentWindow: () => SessionPersistenceWindow }>

const defaultLoadTauriWindowApi: LoadTauriWindowApi = async () => import('@tauri-apps/api/window')

let autoSaveIntervalId: number | null = null
let closeHandlerRegistered = false
let saveSessionInFlight: Promise<void> | null = null
let saveSessionRequestId = 0
let saveSessionCompletedRequestId = 0
const saveSessionWaiters = new Map<
  number,
  { resolve: () => void; reject: (error: Error) => void }
>()
let loadTauriWindowApi: LoadTauriWindowApi = defaultLoadTauriWindowApi

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface SessionRestoreState {
  /** True while restoring session on app launch. */
  isRestoring: boolean
  /** Error message if restore failed. */
  restoreError: string | null

  // Actions
  saveSession: (options?: SaveSessionOptions) => Promise<void>
  restoreSession: () => Promise<void>
  isEnabled: () => boolean
}

export const useSessionRestoreStore = create<SessionRestoreState>()((set, get) => ({
  isRestoring: false,
  restoreError: null,

  isEnabled: (): boolean => {
    return useSettingsStore.getState().getSetting('session.restore') === 'true'
  },

  saveSession: async (options?: SaveSessionOptions): Promise<void> => {
    if (!get().isEnabled()) {
      return
    }

    const requestId = ++saveSessionRequestId
    const waitForSave = new Promise<void>((resolve, reject) => {
      saveSessionWaiters.set(requestId, { resolve, reject })
    })

    if (!saveSessionInFlight) {
      saveSessionInFlight = runSaveSessionQueue().finally(() => {
        saveSessionInFlight = null
      })
    }

    if (options?.throwOnError) {
      await waitForSave
      return
    }

    await waitForSave.catch(() => {})
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
        return
      }

      // Ensure saved connections are loaded so we can look them up by profile ID
      await useConnectionStore.getState().fetchSavedConnections()
      const restoredSessionIdsBySavedIndex: Array<string | null> = Array.from(
        { length: state.connections.length },
        () => null
      )

      for (const [savedIndex, connState] of state.connections.entries()) {
        try {
          const sessionId = await connectByProfileId(connState.profileId)
          if (!sessionId) {
            continue
          }
          restoredSessionIdsBySavedIndex[savedIndex] = sessionId

          // Restore tabs for this connection
          await restoreConnectionTabs(sessionId, connState)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          logFrontend(
            'error',
            `[session-restore] Failed to restore connection ${connState.profileId}: ${msg}`
          )
          showErrorToast('Session restore failed', `Could not reconnect: ${msg}`)
        }
      }

      if (typeof state.activeConnectionIndex === 'number') {
        const activeSessionId = restoredSessionIdsBySavedIndex[state.activeConnectionIndex] ?? null
        if (activeSessionId) {
          useConnectionStore.getState().switchTab(activeSessionId)
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logFrontend('error', `[session-restore] Failed to restore session: ${msg}`)
      set({ restoreError: msg })
      showErrorToast('Session restore failed', msg)
    } finally {
      set({ isRestoring: false })
    }
  },
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the session state snapshot from the current stores.
 */
async function runSaveSessionQueue(): Promise<void> {
  while (saveSessionCompletedRequestId < saveSessionRequestId) {
    const requestId = saveSessionRequestId
    let error: Error | null = null

    try {
      const state = buildSessionState()
      await saveSessionState(state)
    } catch (e) {
      error = e instanceof Error ? e : new Error(String(e))
      const msg = error.message
      logFrontend('error', `[session-restore] Failed to save session state: ${msg}`)
    }

    saveSessionCompletedRequestId = requestId

    for (const completedRequestId of [...saveSessionWaiters.keys()].sort((a, b) => a - b)) {
      if (completedRequestId > requestId) {
        continue
      }

      const waiter = saveSessionWaiters.get(completedRequestId)
      if (!waiter) {
        continue
      }

      saveSessionWaiters.delete(completedRequestId)
      if (error) {
        waiter.reject(error)
      } else {
        waiter.resolve()
      }
    }
  }
}

function buildSessionState(): SessionState {
  const connectionStore = useConnectionStore.getState()
  const workspaceStore = useWorkspaceStore.getState()
  const queryStore = useQueryStore.getState()

  const connections: SessionConnectionState[] = []

  const orderedConnectionIds = normalizeActiveConnectionOrder(
    connectionStore.activeConnectionOrder,
    connectionStore.activeConnections
  )
  const activeConnectionIndex =
    connectionStore.activeTabId != null
      ? orderedConnectionIds.indexOf(connectionStore.activeTabId)
      : -1

  for (const sessionId of orderedConnectionIds) {
    const active = connectionStore.activeConnections[sessionId]
    if (!active) {
      continue
    }
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

  return {
    version: 1,
    connections,
    activeConnectionIndex: activeConnectionIndex >= 0 ? activeConnectionIndex : undefined,
  }
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
    // table-designer, object-editor, and processlist are NOT serialized
    case 'table-designer':
    case 'object-editor':
    case 'processlist':
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
    logFrontend(
      'warn',
      `[session-restore] Profile ${profileId} not found in saved connections, skipping`
    )
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
  logFrontend('warn', `[session-restore] Could not find new session ID for profile ${profileId}`)
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
          label: tabState.tableName,
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
          label: tabState.objectName,
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
        workspaceStore.openHistoryTab(sessionId, false)
        const allTabs = useWorkspaceStore.getState().tabsByConnection[sessionId] ?? []
        const created = allTabs.find((t) => t.type === 'history')
        restoredTabId = created?.id ?? null

        // Ensure processlist tab is also created for restored connections
        workspaceStore.openProcessListTab(sessionId)
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

function registerAutoSaveInterval(): void {
  if (typeof window === 'undefined' || autoSaveIntervalId != null) {
    return
  }

  autoSaveIntervalId = window.setInterval(() => {
    void useSessionRestoreStore.getState().saveSession()
  }, SESSION_AUTOSAVE_INTERVAL_MS)
}

export function _resetSessionPersistenceForTests(): void {
  if (autoSaveIntervalId != null && typeof window !== 'undefined') {
    window.clearInterval(autoSaveIntervalId)
  }
  autoSaveIntervalId = null
  closeHandlerRegistered = false
  saveSessionInFlight = null
  saveSessionRequestId = 0
  saveSessionCompletedRequestId = 0
  saveSessionWaiters.clear()
  loadTauriWindowApi = defaultLoadTauriWindowApi
}

export function _setLoadTauriWindowApiForTests(loader: LoadTauriWindowApi): void {
  loadTauriWindowApi = loader
}

/**
 * Register periodic autosave and the window close handler that saves session state before exiting.
 * Must be called after settings are loaded.
 *
 * Uses dynamic import of `@tauri-apps/api/window` to avoid issues in
 * environments without Tauri internals (Vitest, plain Vite).
 */
export async function registerCloseHandler(): Promise<void> {
  if (!hasTauriApis()) {
    return
  }

  registerAutoSaveInterval()

  if (closeHandlerRegistered) {
    return
  }

  try {
    const { getCurrentWindow } = await loadTauriWindowApi()
    const appWindow = getCurrentWindow()

    await appWindow.onCloseRequested(async (event) => {
      event.preventDefault()
      try {
        await useSessionRestoreStore.getState().saveSession({ throwOnError: true })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        showErrorToast('Session save failed', 'Could not save the current session before closing.')
        logFrontend('error', `[session-restore] Error saving session on close: ${msg}`)
        return
      }
      await appWindow.destroy()
    })
    closeHandlerRegistered = true
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logFrontend('warn', `[session-restore] Failed to register close handler: ${msg}`)
  }
}
