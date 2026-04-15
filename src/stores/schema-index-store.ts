import { create } from 'zustand'
import { listen } from '@tauri-apps/api/event'
import {
  buildSchemaIndex,
  forceRebuildSchemaIndex,
  getIndexStatus,
  invalidateSchemaIndex,
  type SchemaIndexStatus,
} from '../lib/schema-index-commands'
import { logFrontend } from '../lib/app-log-commands'
import { useSettingsStore } from './settings-store'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConnectionIndexState {
  status: SchemaIndexStatus['status']
  tablesDone: number
  tablesTotal: number
  lastBuildTimestamp: number
  error?: string
}

interface SchemaIndexStore {
  // State
  connections: Record<string, ConnectionIndexState>
  profileToSessions: Record<string, string[]>
  sessionToProfile: Record<string, string>

  // Actions
  registerSession: (sessionId: string, profileId: string) => void
  unregisterSession: (sessionId: string) => void
  triggerBuild: (sessionId: string) => Promise<void>
  forceRebuild: (sessionId: string) => Promise<void>
  triggerInvalidation: (sessionId: string, tables: string[]) => Promise<void>
  getStatusForSession: (sessionId: string) => ConnectionIndexState | undefined

  // Internal — called by event listeners
  _handleProgress: (profileId: string, tablesDone: number, tablesTotal: number) => void
  _handleComplete: (profileId: string) => void
  _handleError: (profileId: string, error: string) => void
}

// ---------------------------------------------------------------------------
// Default connection index state
// ---------------------------------------------------------------------------

function createDefaultConnectionIndexState(): ConnectionIndexState {
  return {
    status: 'stale',
    tablesDone: 0,
    tablesTotal: 0,
    lastBuildTimestamp: 0,
  }
}

// ---------------------------------------------------------------------------
// Tauri event listener detection
// ---------------------------------------------------------------------------

/** Tauri's `listen()` requires injected internals; absent in jsdom / Vitest / plain Vite. */
function canUseTauriEventListen(): boolean {
  if (typeof window === 'undefined') return false
  return (
    '__TAURI_INTERNALS__' in window &&
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ != null
  )
}

// ---------------------------------------------------------------------------
// Shared helper for event handlers
// ---------------------------------------------------------------------------

/** Resolve all sessions for a profile, apply an update to each connection state. */
function updateSessionsForProfile(
  get: () => SchemaIndexStore,
  set: (fn: (state: SchemaIndexStore) => Partial<SchemaIndexStore>) => void,
  profileId: string,
  update: (conn: ConnectionIndexState) => ConnectionIndexState
): void {
  const sessions = get().profileToSessions[profileId] ?? []
  if (sessions.length === 0) return

  set((s) => {
    const newConnections = { ...s.connections }
    for (const sid of sessions) {
      newConnections[sid] = update(newConnections[sid] ?? createDefaultConnectionIndexState())
    }
    return { connections: newConnections }
  })
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useSchemaIndexStore = create<SchemaIndexStore>()((set, get) => {
  // ------ Event listener setup (lazy, once) ------

  let listenersInitialized = false

  function initEventListeners(): void {
    if (listenersInitialized || !canUseTauriEventListen()) return
    listenersInitialized = true

    listen<{ profileId: string; tablesDone: number; tablesTotal: number }>(
      'schema-index-progress',
      (event) => {
        get()._handleProgress(
          event.payload.profileId,
          event.payload.tablesDone,
          event.payload.tablesTotal
        )
      }
    ).catch((err) => {
      console.error('[schema-index-store] Failed to listen for schema-index-progress:', err)
    })

    listen<{ profileId: string; tablesIndexed: number; durationMs: number }>(
      'schema-index-complete',
      (event) => {
        get()._handleComplete(event.payload.profileId)
      }
    ).catch((err) => {
      console.error('[schema-index-store] Failed to listen for schema-index-complete:', err)
    })

    listen<{ profileId: string; error: string }>('schema-index-error', (event) => {
      get()._handleError(event.payload.profileId, event.payload.error)
    }).catch((err) => {
      console.error('[schema-index-store] Failed to listen for schema-index-error:', err)
    })
  }

  // ------ Settings change subscription ------

  let settingsUnsubscribed = false

  function initSettingsSubscription(): void {
    if (settingsUnsubscribed) return
    settingsUnsubscribed = true

    // Subscribe to settings store for ai.embeddingModel changes
    let prevEmbeddingModel = useSettingsStore.getState().getSetting('ai.embeddingModel')

    useSettingsStore.subscribe((state) => {
      const currentModel = state.getSetting('ai.embeddingModel')
      if (currentModel !== prevEmbeddingModel) {
        prevEmbeddingModel = currentModel

        // Trigger rebuild for all active sessions
        const store = get()
        const allSessions = Object.keys(store.sessionToProfile)
        for (const sessionId of allSessions) {
          store.triggerBuild(sessionId).catch((err) => {
            const msg = err instanceof Error ? err.message : String(err)
            console.error(
              `[schema-index-store] Failed to rebuild index for session ${sessionId} after model change:`,
              msg
            )
          })
        }
      }
    })
  }

  return {
    connections: {},
    profileToSessions: {},
    sessionToProfile: {},

    registerSession: (sessionId, profileId) => {
      // Initialize event listeners on first registration
      initEventListeners()
      initSettingsSubscription()

      set((state) => {
        const existingSessions = state.profileToSessions[profileId] ?? []
        return {
          connections: {
            ...state.connections,
            [sessionId]: createDefaultConnectionIndexState(),
          },
          profileToSessions: {
            ...state.profileToSessions,
            [profileId]: [...existingSessions, sessionId],
          },
          sessionToProfile: {
            ...state.sessionToProfile,
            [sessionId]: profileId,
          },
        }
      })

      // Query the real backend status asynchronously (fire-and-forget)
      getIndexStatus(sessionId)
        .then((status) => {
          set((state) => {
            const conn = state.connections[sessionId]
            if (!conn) return state
            return {
              connections: {
                ...state.connections,
                [sessionId]: {
                  ...conn,
                  status: status.status,
                },
              },
            }
          })
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err)
          console.error(
            `[schema-index-store] Failed to get initial index status for ${sessionId}:`,
            msg
          )
        })
    },

    unregisterSession: (sessionId) => {
      set((state) => {
        const profileId = state.sessionToProfile[sessionId]
        if (!profileId) return state

        const newConnections = { ...state.connections }
        delete newConnections[sessionId]

        const newSessionToProfile = { ...state.sessionToProfile }
        delete newSessionToProfile[sessionId]

        const newProfileToSessions = { ...state.profileToSessions }
        const sessions = (newProfileToSessions[profileId] ?? []).filter((s) => s !== sessionId)
        if (sessions.length === 0) {
          delete newProfileToSessions[profileId]
        } else {
          newProfileToSessions[profileId] = sessions
        }

        return {
          connections: newConnections,
          profileToSessions: newProfileToSessions,
          sessionToProfile: newSessionToProfile,
        }
      })
    },

    triggerBuild: async (sessionId) => {
      const state = get()
      if (!state.sessionToProfile[sessionId]) return

      // Set status to building
      set((s) => ({
        connections: {
          ...s.connections,
          [sessionId]: {
            ...(s.connections[sessionId] ?? createDefaultConnectionIndexState()),
            status: 'building' as const,
            tablesDone: 0,
            tablesTotal: 0,
          },
        },
      }))

      try {
        await buildSchemaIndex(sessionId)

        // After triggering, check actual backend status.
        // The backend may have returned early (e.g. not_configured) without emitting events.
        try {
          const realStatus = await getIndexStatus(sessionId)
          set((s) => {
            const conn = s.connections[sessionId]
            if (!conn) return s
            // Only update if we're still in 'building' — events may have already updated it
            if (conn.status === 'building' || conn.status === 'stale') {
              return {
                connections: {
                  ...s.connections,
                  [sessionId]: {
                    ...conn,
                    status: realStatus.status,
                  },
                },
              }
            }
            return s
          })
        } catch {
          // Status check failed — non-critical, events will update status
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[schema-index-store] Failed to trigger build:', msg)
        logFrontend('error', `[schema-index-store] Build failed for ${sessionId}: ${msg}`)

        set((s) => ({
          connections: {
            ...s.connections,
            [sessionId]: {
              ...(s.connections[sessionId] ?? createDefaultConnectionIndexState()),
              status: 'error' as const,
              error: msg,
            },
          },
        }))
      }
    },

    forceRebuild: async (sessionId) => {
      const state = get()
      if (!state.sessionToProfile[sessionId]) return

      // Set status to building
      set((s) => ({
        connections: {
          ...s.connections,
          [sessionId]: {
            ...(s.connections[sessionId] ?? createDefaultConnectionIndexState()),
            status: 'building' as const,
            tablesDone: 0,
            tablesTotal: 0,
          },
        },
      }))

      try {
        await forceRebuildSchemaIndex(sessionId)

        // After triggering, check actual backend status.
        // The backend may have returned early (e.g. not_configured) without emitting events.
        try {
          const realStatus = await getIndexStatus(sessionId)
          set((s) => {
            const conn = s.connections[sessionId]
            if (!conn) return s
            // Only update if we're still in 'building' — events may have already updated it
            if (conn.status === 'building' || conn.status === 'stale') {
              return {
                connections: {
                  ...s.connections,
                  [sessionId]: {
                    ...conn,
                    status: realStatus.status,
                  },
                },
              }
            }
            return s
          })
        } catch {
          // Status check failed — non-critical, events will update status
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[schema-index-store] Failed to force rebuild:', msg)
        logFrontend('error', `[schema-index-store] Force rebuild failed for ${sessionId}: ${msg}`)

        set((s) => ({
          connections: {
            ...s.connections,
            [sessionId]: {
              ...(s.connections[sessionId] ?? createDefaultConnectionIndexState()),
              status: 'error' as const,
              error: msg,
            },
          },
        }))
      }
    },

    triggerInvalidation: async (sessionId, tables) => {
      try {
        await invalidateSchemaIndex(sessionId, tables)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[schema-index-store] Failed to invalidate index:', msg)
        logFrontend('warn', `[schema-index-store] Invalidation failed for ${sessionId}: ${msg}`)
      }
    },

    getStatusForSession: (sessionId) => {
      return get().connections[sessionId]
    },

    _handleProgress: (profileId, tablesDone, tablesTotal) => {
      updateSessionsForProfile(get, set, profileId, (conn) => ({
        ...conn,
        status: 'building',
        tablesDone,
        tablesTotal,
      }))
    },

    _handleComplete: (profileId) => {
      updateSessionsForProfile(get, set, profileId, (conn) => ({
        ...conn,
        status: 'ready',
        lastBuildTimestamp: Date.now(),
      }))
    },

    _handleError: (profileId, error) => {
      updateSessionsForProfile(get, set, profileId, (conn) => ({
        ...conn,
        status: 'error',
        error,
      }))
    },
  }
})
