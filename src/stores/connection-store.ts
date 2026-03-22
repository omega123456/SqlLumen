import { create } from 'zustand'
import { listen } from '@tauri-apps/api/event'
import {
  listConnections,
  listConnectionGroups,
  openConnection as openConnectionIPC,
  closeConnection as closeConnectionIPC,
  updateConnection as updateConnectionIPC,
} from '../lib/connection-commands'
import type {
  SavedConnection,
  ConnectionGroup,
  ActiveConnection,
  ConnectionStatusEvent,
} from '../types/connection'
import { useSchemaStore } from './schema-store'
import { useWorkspaceStore } from './workspace-store'
import { showErrorToast, showSuccessToast } from './toast-store'

let listenersSetup = false

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
  updateDefaultDatabase: (connectionId: string, newDefaultDb: string | null) => Promise<void>
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
        id,
        profile,
        status: 'connected',
        serverVersion: result.serverVersion,
      }

      set((state) => ({
        activeConnections: { ...state.activeConnections, [id]: active },
        activeTabId: id,
        error: null,
      }))
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
      await closeConnectionIPC(id)

      // Clear dependent store state for this connection
      useSchemaStore.getState().clearConnectionState(id)
      useWorkspaceStore.getState().clearConnectionTabs(id)

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

  updateDefaultDatabase: async (connectionId: string, newDefaultDb: string | null) => {
    const active = get().activeConnections[connectionId]
    if (!active) return

    const originalDefault = active.profile.defaultDatabase
    const updatedProfile = { ...active.profile, defaultDatabase: newDefaultDb }

    // Update in-memory optimistically
    set((state) => ({
      activeConnections: {
        ...state.activeConnections,
        [connectionId]: {
          ...state.activeConnections[connectionId],
          profile: updatedProfile,
        },
      },
      savedConnections: state.savedConnections.map((c) =>
        c.id === connectionId ? { ...c, defaultDatabase: newDefaultDb } : c
      ),
    }))

    // Persist via IPC — revert in-memory state on failure
    try {
      await updateConnectionIPC(connectionId, {
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
      // Revert in-memory state if connection still exists
      const current = get().activeConnections[connectionId]
      if (current) {
        set((state) => ({
          activeConnections: {
            ...state.activeConnections,
            [connectionId]: {
              ...state.activeConnections[connectionId],
              profile: {
                ...state.activeConnections[connectionId].profile,
                defaultDatabase: originalDefault,
              },
            },
          },
          savedConnections: state.savedConnections.map((c) =>
            c.id === connectionId ? { ...c, defaultDatabase: originalDefault } : c
          ),
        }))
      }
    }
  },

  setupEventListeners: async () => {
    if (listenersSetup) return undefined
    listenersSetup = true

    try {
      const unlisten = await listen<ConnectionStatusEvent>('connection-status-changed', (event) => {
        get().updateConnectionStatus(event.payload)
      })
      return unlisten
    } catch {
      // Silently ignore — listen is unavailable outside Tauri runtime (browser/test)
      listenersSetup = false
      return undefined
    }
  },
}))
