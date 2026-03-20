import { create } from 'zustand'
import { listen } from '@tauri-apps/api/event'
import {
  listConnections,
  listConnectionGroups,
  openConnection as openConnectionIPC,
  closeConnection as closeConnectionIPC,
} from '../lib/connection-commands'
import type {
  SavedConnection,
  ConnectionGroup,
  ActiveConnection,
  ConnectionStatusEvent,
} from '../types/connection'

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
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  openConnection: async (id: string) => {
    const profile = get().savedConnections.find((c) => c.id === id)
    if (!profile) {
      const errorMsg = `Connection profile '${id}' not found`
      set({ error: errorMsg })
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
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      set({ error: errorMsg })
      throw err
    }
  },

  closeConnection: async (id: string) => {
    try {
      await closeConnectionIPC(id)

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
      set({ error: err instanceof Error ? err.message : String(err) })
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
