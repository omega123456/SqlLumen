import { create } from 'zustand'
import { listen } from '@tauri-apps/api/event'
import {
  buildSchemaIndex,
  forceRebuildSchemaIndex,
  getIndexStatus,
  invalidateSchemaIndex,
  type SchemaIndexStatus,
} from '../lib/schema-index-commands'
import { useSettingsStore } from './settings-store'
import { hasTauriApis } from '../lib/tauri-env'

import { logFrontend } from '../lib/app-log-commands'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BuildPhase = 'loading_schema' | 'embedding' | 'finalizing'

export interface ConnectionIndexState {
  status: SchemaIndexStatus['status']
  /**
   * Current phase of an in-flight build. `null` means no known phase yet
   * (either not building, or building but no progress event has arrived).
   */
  phase: BuildPhase | null
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
  _handleProgress: (
    profileId: string,
    phase: BuildPhase,
    tablesDone: number,
    tablesTotal: number
  ) => void
  _handleComplete: (profileId: string) => void
  _handleError: (profileId: string, error: string) => void
}

// Module-level subscription handle: guards against double-subscription and
// provides cleanup when all sessions are unregistered.
let settingsUnsub: (() => void) | null = null

/** Test-only: tear down the settings subscription so each test starts clean. */
export function _resetSchemaIndexStoreForTest(): void {
  settingsUnsub?.()
  settingsUnsub = null
}

// ---------------------------------------------------------------------------
// Default connection index state
// ---------------------------------------------------------------------------

function createDefaultConnectionIndexState(): ConnectionIndexState {
  return {
    status: 'stale',
    phase: null,
    tablesDone: 0,
    tablesTotal: 0,
    lastBuildTimestamp: 0,
  }
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
    if (listenersInitialized || !hasTauriApis()) return
    listenersInitialized = true

    listen<{
      profileId: string
      phase: BuildPhase
      tablesDone: number
      tablesTotal: number
    }>('schema-index-progress', (event) => {
      get()._handleProgress(
        event.payload.profileId,
        event.payload.phase,
        event.payload.tablesDone,
        event.payload.tablesTotal
      )
    }).catch((err) => {
      logFrontend(
        'error',
        ['[schema-index-store] Failed to listen for schema-index-progress:', err]
          .map(String)
          .join(' ')
      )
    })

    listen<{ profileId: string; tablesIndexed: number; durationMs: number }>(
      'schema-index-complete',
      (event) => {
        get()._handleComplete(event.payload.profileId)
      }
    ).catch((err) => {
      logFrontend(
        'error',
        ['[schema-index-store] Failed to listen for schema-index-complete:', err]
          .map(String)
          .join(' ')
      )
    })

    listen<{ profileId: string; error: string }>('schema-index-error', (event) => {
      get()._handleError(event.payload.profileId, event.payload.error)
    }).catch((err) => {
      logFrontend(
        'error',
        ['[schema-index-store] Failed to listen for schema-index-error:', err].map(String).join(' ')
      )
    })
  }

  // ------ Settings change subscription ------

  function initSettingsSubscription(): void {
    if (settingsUnsub) return

    // Subscribe to settings store for ai.embeddingModel changes
    let prevEmbeddingModel = useSettingsStore.getState().getSetting('ai.embeddingModel')

    settingsUnsub = useSettingsStore.subscribe((state) => {
      const currentModel = state.getSetting('ai.embeddingModel')
      if (currentModel !== prevEmbeddingModel) {
        prevEmbeddingModel = currentModel

        // Trigger rebuild for all active sessions
        const store = get()
        const allSessions = Object.keys(store.sessionToProfile)
        for (const sessionId of allSessions) {
          store.triggerBuild(sessionId).catch((err) => {
            const msg = err instanceof Error ? err.message : String(err)
            logFrontend(
              'error',
              [
                `[schema-index-store] Failed to rebuild index for session ${sessionId} after model change:`,
                msg,
              ]
                .map(String)
                .join(' ')
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
          logFrontend(
            'warn',
            `[schema-index-store] Failed to get initial index status for ${sessionId}: ${msg}`
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

      // Clean up the settings subscription when all sessions are gone
      if (Object.keys(get().sessionToProfile).length === 0 && settingsUnsub) {
        settingsUnsub()
        settingsUnsub = null
      }
    },

    triggerBuild: async (sessionId) => {
      const state = get()
      const profileId = state.sessionToProfile[sessionId]
      if (!profileId) {
        return
      }

      // Profile-level deduplication: if any sibling session for the same
      // profile is already 'building' or 'ready', skip the build and just
      // mirror the existing status to this session.
      const siblingSessionIds = state.profileToSessions[profileId] ?? []
      for (const sid of siblingSessionIds) {
        if (sid === sessionId) continue
        const siblingConn = state.connections[sid]
        if (siblingConn && (siblingConn.status === 'building' || siblingConn.status === 'ready')) {
          set((s) => ({
            connections: {
              ...s.connections,
              [sessionId]: {
                ...(s.connections[sessionId] ?? createDefaultConnectionIndexState()),
                status: siblingConn.status,
                phase: siblingConn.phase,
                tablesDone: siblingConn.tablesDone,
                tablesTotal: siblingConn.tablesTotal,
                lastBuildTimestamp: siblingConn.lastBuildTimestamp,
              },
            },
          }))
          return
        }
      }

      set((s) => ({
        connections: {
          ...s.connections,
          [sessionId]: {
            ...(s.connections[sessionId] ?? createDefaultConnectionIndexState()),
            status: 'building' as const,
            phase: null,
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
        logFrontend(
          'error',
          ['[schema-index-store] Failed to trigger build:', msg].map(String).join(' ')
        )
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
      if (!state.sessionToProfile[sessionId]) {
        return
      }

      set((s) => ({
        connections: {
          ...s.connections,
          [sessionId]: {
            ...(s.connections[sessionId] ?? createDefaultConnectionIndexState()),
            status: 'building' as const,
            phase: null,
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
        logFrontend(
          'error',
          ['[schema-index-store] Failed to force rebuild:', msg].map(String).join(' ')
        )
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
        logFrontend(
          'error',
          ['[schema-index-store] Failed to invalidate index:', msg].map(String).join(' ')
        )
        logFrontend('warn', `[schema-index-store] Invalidation failed for ${sessionId}: ${msg}`)
      }
    },

    getStatusForSession: (sessionId) => {
      return get().connections[sessionId]
    },

    _handleProgress: (profileId, phase, tablesDone, tablesTotal) => {
      updateSessionsForProfile(get, set, profileId, (conn) => ({
        ...conn,
        status: 'building',
        phase,
        tablesDone,
        tablesTotal,
      }))
    },

    _handleComplete: (profileId) => {
      updateSessionsForProfile(get, set, profileId, (conn) => ({
        ...conn,
        status: 'ready',
        phase: null,
        lastBuildTimestamp: Date.now(),
      }))
    },

    _handleError: (profileId, error) => {
      updateSessionsForProfile(get, set, profileId, (conn) => ({
        ...conn,
        status: 'error',
        phase: null,
        error,
      }))
    },
  }
})
