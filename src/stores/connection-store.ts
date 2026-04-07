import { create } from 'zustand'
import { listen } from '@tauri-apps/api/event'
import {
  listConnections,
  listConnectionGroups,
  openConnection as openConnectionIPC,
  closeConnection as closeConnectionIPC,
  updateConnection as updateConnectionIPC,
} from '../lib/connection-commands'
import { selectDatabase as selectDatabaseIPC } from '../lib/query-commands'
import type {
  SavedConnection,
  ConnectionGroup,
  ActiveConnection,
  ConnectionStatusEvent,
} from '../types/connection'
import { useSchemaStore } from './schema-store'
import { useWorkspaceStore } from './workspace-store'
import { useQueryStore } from './query-store'
import { useTableDataStore } from './table-data-store'
import { useObjectEditorStore } from './object-editor-store'
import { showErrorToast, showSuccessToast } from './toast-store'
import { invalidateCache } from '../components/query-editor/schema-metadata-cache'
import { invalidateRoutineCache } from '../components/query-editor/routine-parameter-cache'

let listenersSetup = false

/** Tauri’s `listen()` requires injected internals; absent in jsdom / Vitest / plain Vite. */
function canUseTauriEventListen(): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  return (
    '__TAURI_INTERNALS__' in window &&
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ != null
  )
}

/** Reset the listeners flag — for testing only */
export function _resetListenersSetup() {
  listenersSetup = false
}

interface ConnectionState {
  // Saved data (from backend)
  savedConnections: SavedConnection[]
  connectionGroups: ConnectionGroup[]

  // Active connections (open tabs)
  activeConnections: Record<string, ActiveConnection>
  activeTabId: string | null

  // Dialog state
  dialogOpen: boolean

  // Error state
  error: string | null

  // Actions
  fetchSavedConnections: () => Promise<void>
  openConnection: (id: string) => Promise<void>
  closeConnection: (id: string) => Promise<void>
  switchTab: (id: string) => void
  updateConnectionStatus: (event: ConnectionStatusEvent) => void
  openDialog: () => void
  closeDialog: () => void
  clearError: () => void
  setActiveDatabase: (sessionId: string, databaseName: string) => Promise<void>
  updateDefaultDatabase: (sessionId: string, newDefaultDb: string | null) => Promise<void>
  setupEventListeners: () => Promise<(() => void) | undefined>
}

export const useConnectionStore = create<ConnectionState>()((set, get) => ({
  savedConnections: [],
  connectionGroups: [],
  activeConnections: {},
  activeTabId: null,
  dialogOpen: false,
  error: null,

  fetchSavedConnections: async () => {
    try {
      const [connections, groups] = await Promise.all([listConnections(), listConnectionGroups()])
      set({ savedConnections: connections, connectionGroups: groups, error: null })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      set({ error: msg })
      showErrorToast('Failed to load connections', msg)
    }
  },

  openConnection: async (id: string) => {
    const profile = get().savedConnections.find((c) => c.id === id)
    if (!profile) {
      const errorMsg = `Connection profile '${id}' not found`
      set({ error: errorMsg })
      showErrorToast('Connection failed', errorMsg)
      throw new Error(errorMsg)
    }

    try {
      const result = await openConnectionIPC(id)

      const active: ActiveConnection = {
        id: result.sessionId,
        profile,
        sessionDatabase: profile.defaultDatabase,
        status: 'connected',
        serverVersion: result.serverVersion,
      }

      set((state) => ({
        activeConnections: { ...state.activeConnections, [result.sessionId]: active },
        activeTabId: result.sessionId,
        error: null,
      }))
      useWorkspaceStore.getState().openHistoryTab(result.sessionId, false)
      showSuccessToast('Connected', profile.name)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      set({ error: errorMsg })
      showErrorToast('Connection failed', errorMsg)
      throw err
    }
  },

  closeConnection: async (id: string) => {
    try {
      // Auto-save any pending edits in query-editor tabs before closing.
      // For each query tab, check if any results have unsaved edits and
      // try to save them. Non-active dirty results cannot be saved by
      // saveCurrentRow, so we prompt the user rather than silently losing them.
      const workspaceTabs = useWorkspaceStore.getState().tabsByConnection[id] ?? []
      for (const tab of workspaceTabs) {
        if (tab.type === 'query-editor') {
          const queryTabState = useQueryStore.getState().tabs[tab.id]
          if (!queryTabState?.results) continue

          const activeIdx = queryTabState.activeResultIndex ?? 0

          // Check for dirty non-active results — these cannot be saved
          // by saveCurrentRow, so we need to prompt the user.
          const hasNonActiveDirty = queryTabState.results.some(
            (r, i) => i !== activeIdx && r.editState && r.editState.modifiedColumns.size > 0
          )
          if (hasNonActiveDirty) {
            const confirmed = globalThis.confirm(
              'You have unsaved changes in non-active query results. Close connection anyway? Unsaved changes will be lost.'
            )
            if (!confirmed) return
            // User confirmed losing non-active dirty results, but still
            // try to save the active result if it's dirty (fall through).
          }

          // Check the active result for dirty edits — try to save it
          const activeResult = queryTabState.results[activeIdx]
          const activeIsDirty =
            activeResult?.editState && activeResult.editState.modifiedColumns.size > 0
          if (activeIsDirty) {
            const saved = await useQueryStore.getState().saveCurrentRow(tab.id)
            if (!saved) {
              showErrorToast(
                'Connection not closed',
                'Could not save pending edits. Fix or discard changes before closing.'
              )
              return
            }
          }
        } else if (tab.type === 'table-data') {
          const tableDataTabState = useTableDataStore.getState().tabs[tab.id]
          if (
            tableDataTabState?.editState &&
            tableDataTabState.editState.modifiedColumns.size > 0
          ) {
            const saved = await useTableDataStore.getState().saveCurrentRow(tab.id)
            if (!saved) {
              showErrorToast(
                'Connection not closed',
                'Could not save pending edits. Fix or discard changes before closing.'
              )
              return
            }
          }
        }
      }

      // Check for dirty object-editor tabs before closing
      const objectEditorState = useObjectEditorStore.getState()
      const dirtyObjectEditorTabs = workspaceTabs.filter(
        (tab) => tab.type === 'object-editor' && objectEditorState.isDirty(tab.id)
      )
      if (dirtyObjectEditorTabs.length > 0) {
        const confirmed = globalThis.confirm(
          'You have unsaved changes in object editor tabs. Close connection anyway?'
        )
        if (!confirmed) return
      }

      await closeConnectionIPC(id)

      // Clear dependent store state for this connection
      useSchemaStore.getState().clearConnectionState(id)
      useWorkspaceStore.getState().clearConnectionTabs(id)
      invalidateCache(id)
      invalidateRoutineCache(id)

      set((state) => {
        const remaining = { ...state.activeConnections }
        delete remaining[id]
        const remainingIds = Object.keys(remaining)
        const newActiveTabId =
          state.activeTabId === id
            ? remainingIds.length > 0
              ? remainingIds[0]
              : null
            : state.activeTabId

        return {
          activeConnections: remaining,
          activeTabId: newActiveTabId,
          error: null,
        }
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      set({ error: msg })
      showErrorToast('Failed to close connection', msg)
    }
  },

  switchTab: (id: string) => {
    set({ activeTabId: id })
  },

  updateConnectionStatus: (event: ConnectionStatusEvent) => {
    set((state) => {
      const existing = state.activeConnections[event.connectionId]
      if (!existing) return state

      return {
        activeConnections: {
          ...state.activeConnections,
          [event.connectionId]: {
            ...existing,
            status: event.status,
          },
        },
      }
    })
  },

  openDialog: () => set({ dialogOpen: true }),
  closeDialog: () => set({ dialogOpen: false }),
  clearError: () => set({ error: null }),

  setActiveDatabase: async (sessionId: string, databaseName: string) => {
    const active = get().activeConnections[sessionId]
    const trimmedName = databaseName.trim()
    const currentSessionDatabase =
      active?.sessionDatabase ?? active?.profile.defaultDatabase ?? null

    if (!active || !trimmedName || currentSessionDatabase === trimmedName) {
      return
    }

    const originalSessionDatabase = currentSessionDatabase

    set((state) => ({
      activeConnections: {
        ...state.activeConnections,
        [sessionId]: {
          ...state.activeConnections[sessionId],
          sessionDatabase: trimmedName,
        },
      },
    }))

    try {
      await selectDatabaseIPC(sessionId, trimmedName)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      showErrorToast('Failed to switch database', msg)

      if (get().activeConnections[sessionId]) {
        set((state) => ({
          activeConnections: {
            ...state.activeConnections,
            [sessionId]: {
              ...state.activeConnections[sessionId],
              sessionDatabase: originalSessionDatabase,
            },
          },
        }))
      }
    }
  },

  updateDefaultDatabase: async (sessionId: string, newDefaultDb: string | null) => {
    const active = get().activeConnections[sessionId]
    if (!active) {
      return
    }

    const profileId = active.profile.id
    const originalDefault = active.profile.defaultDatabase
    const updatedProfile = { ...active.profile, defaultDatabase: newDefaultDb }

    const patchActivesForProfile = (
      state: { activeConnections: Record<string, ActiveConnection> },
      profile: SavedConnection
    ): Record<string, ActiveConnection> => {
      const next = { ...state.activeConnections }
      for (const sid of Object.keys(next)) {
        if (next[sid].profile.id === profileId) {
          next[sid] = { ...next[sid], profile }
        }
      }
      return next
    }

    // Update in-memory optimistically (all sessions for this profile + saved list)
    set((state) => ({
      activeConnections: patchActivesForProfile(state, updatedProfile),
      savedConnections: state.savedConnections.map((c) =>
        c.id === profileId ? { ...c, defaultDatabase: newDefaultDb } : c
      ),
    }))

    // Persist via IPC — revert in-memory state on failure
    try {
      await updateConnectionIPC(profileId, {
        name: updatedProfile.name,
        host: updatedProfile.host,
        port: updatedProfile.port,
        username: updatedProfile.username,
        password: '', // empty = don't change existing password
        defaultDatabase: newDefaultDb,
        sslEnabled: updatedProfile.sslEnabled,
        sslCaPath: updatedProfile.sslCaPath,
        sslCertPath: updatedProfile.sslCertPath,
        sslKeyPath: updatedProfile.sslKeyPath,
        color: updatedProfile.color,
        groupId: updatedProfile.groupId,
        readOnly: updatedProfile.readOnly,
        connectTimeoutSecs: updatedProfile.connectTimeoutSecs,
        keepaliveIntervalSecs: updatedProfile.keepaliveIntervalSecs,
      })
    } catch (e) {
      console.error('Failed to persist defaultDatabase change:', e)
      const msg = e instanceof Error ? e.message : String(e)
      showErrorToast('Failed to save default database', msg)
      const revertedProfile = { ...updatedProfile, defaultDatabase: originalDefault }
      const current = get().activeConnections[sessionId]
      if (current) {
        set((state) => ({
          activeConnections: patchActivesForProfile(state, revertedProfile),
          savedConnections: state.savedConnections.map((c) =>
            c.id === profileId ? { ...c, defaultDatabase: originalDefault } : c
          ),
        }))
      }
    }
  },

  setupEventListeners: async () => {
    if (listenersSetup) return undefined
    listenersSetup = true

    if (!canUseTauriEventListen()) {
      return undefined
    }

    try {
      const unlisten = await listen<ConnectionStatusEvent>('connection-status-changed', (event) => {
        get().updateConnectionStatus(event.payload)
      })
      return unlisten
    } catch (err) {
      console.warn(
        '[connection-store] connection-status-changed listen failed (unexpected Tauri error):',
        err
      )
      listenersSetup = false
      return undefined
    }
  },
}))
