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

import { logFrontend, logFrontendError } from '../lib/app-log-commands'
import { toErrorMessage } from '../lib/error-message'

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
  set: (updater: (state: SchemaIndexStore) => Partial<SchemaIndexStore>) => void,
  profileId: string,
  update: (connection: ConnectionIndexState) => ConnectionIndexState
): void {
  const sessions = get().profileToSessions[profileId] ?? []
  if (sessions.length === 0) return

  set((state) => {
    const newConnections = { ...state.connections }
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
    }).catch((error) => {
      logFrontendError('[schema-index-store] Failed to listen for schema-index-progress:', error)
    })

    listen<{ profileId: string; tablesIndexed: number; durationMs: number }>(
      'schema-index-complete',
      (event) => {
        get()._handleComplete(event.payload.profileId)
      }
    ).catch((error) => {
      logFrontendError('[schema-index-store] Failed to listen for schema-index-complete:', error)
    })

    listen<{ profileId: string; error: string }>('schema-index-error', (event) => {
      get()._handleError(event.payload.profileId, event.payload.error)
    }).catch((error) => {
      logFrontendError('[schema-index-store] Failed to listen for schema-index-error:', error)
    })
  }

  // ------ Settings change subscription ------

  function initSettingsSubscription(): void {
    if (settingsUnsub) return

    // Subscribe to settings store for ai.embeddingModel changes
    let previousEmbeddingModel = useSettingsStore.getState().getSetting('ai.embeddingModel')

    settingsUnsub = useSettingsStore.subscribe((state) => {
      const currentModel = state.getSetting('ai.embeddingModel')
      if (currentModel !== previousEmbeddingModel) {
        previousEmbeddingModel = currentModel

        // Trigger rebuild for all active sessions
        const store = get()
        const allSessions = Object.keys(store.sessionToProfile)
        for (const sessionId of allSessions) {
          store.triggerBuild(sessionId).catch((error) => {
            const message = toErrorMessage(error)
            logFrontendError(
              `[schema-index-store] Failed to rebuild index for session ${sessionId} after model change:`,
              message
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
            const connection = state.connections[sessionId]
            if (!connection) return state
            return {
              connections: {
                ...state.connections,
                [sessionId]: {
                  ...connection,
                  status: status.status,
                },
              },
            }
          })
        })
        .catch((error) => {
          const message = toErrorMessage(error)
          logFrontend(
            'warn',
            `[schema-index-store] Failed to get initial index status for ${sessionId}: ${message}`
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
        const sessions = (newProfileToSessions[profileId] ?? []).filter(
          (otherSessionId) => otherSessionId !== sessionId
        )
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
        const siblingConnection = state.connections[sid]
        if (
          siblingConnection &&
          (siblingConnection.status === 'building' || siblingConnection.status === 'ready')
        ) {
          set((state) => ({
            connections: {
              ...state.connections,
              [sessionId]: {
                ...(state.connections[sessionId] ?? createDefaultConnectionIndexState()),
                status: siblingConnection.status,
                phase: siblingConnection.phase,
                tablesDone: siblingConnection.tablesDone,
                tablesTotal: siblingConnection.tablesTotal,
                lastBuildTimestamp: siblingConnection.lastBuildTimestamp,
              },
            },
          }))
          return
        }
      }

      set((state) => ({
        connections: {
          ...state.connections,
          [sessionId]: {
            ...(state.connections[sessionId] ?? createDefaultConnectionIndexState()),
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
          set((state) => {
            const connection = state.connections[sessionId]
            if (!connection) return state
            // Only update if we're still in 'building' — events may have already updated it
            if (connection.status === 'building' || connection.status === 'stale') {
              return {
                connections: {
                  ...state.connections,
                  [sessionId]: {
                    ...connection,
                    status: realStatus.status,
                  },
                },
              }
            }
            return state
          })
        } catch (error) {
          logFrontend(
            'warn',
            `[schema-index-store] Index status check failed; waiting for index events: ${String(error)}`
          )
        }
      } catch (error) {
        const message = toErrorMessage(error)
        logFrontendError('[schema-index-store] Failed to trigger build:', message)
        logFrontend('error', `[schema-index-store] Build failed for ${sessionId}: ${message}`)

        set((state) => ({
          connections: {
            ...state.connections,
            [sessionId]: {
              ...(state.connections[sessionId] ?? createDefaultConnectionIndexState()),
              status: 'error' as const,
              error: message,
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

      set((state) => ({
        connections: {
          ...state.connections,
          [sessionId]: {
            ...(state.connections[sessionId] ?? createDefaultConnectionIndexState()),
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
          set((state) => {
            const connection = state.connections[sessionId]
            if (!connection) return state
            // Only update if we're still in 'building' — events may have already updated it
            if (connection.status === 'building' || connection.status === 'stale') {
              return {
                connections: {
                  ...state.connections,
                  [sessionId]: {
                    ...connection,
                    status: realStatus.status,
                  },
                },
              }
            }
            return state
          })
        } catch (error) {
          logFrontend(
            'warn',
            `[schema-index-store] Index status check failed; waiting for index events: ${String(error)}`
          )
        }
      } catch (error) {
        const message = toErrorMessage(error)
        logFrontendError('[schema-index-store] Failed to force rebuild:', message)
        logFrontend(
          'error',
          `[schema-index-store] Force rebuild failed for ${sessionId}: ${message}`
        )

        set((state) => ({
          connections: {
            ...state.connections,
            [sessionId]: {
              ...(state.connections[sessionId] ?? createDefaultConnectionIndexState()),
              status: 'error' as const,
              error: message,
            },
          },
        }))
      }
    },

    triggerInvalidation: async (sessionId, tables) => {
      try {
        await invalidateSchemaIndex(sessionId, tables)
      } catch (error) {
        const message = toErrorMessage(error)
        logFrontendError('[schema-index-store] Failed to invalidate index:', message)
        logFrontend('warn', `[schema-index-store] Invalidation failed for ${sessionId}: ${message}`)
      }
    },

    getStatusForSession: (sessionId) => {
      return get().connections[sessionId]
    },

    _handleProgress: (profileId, phase, tablesDone, tablesTotal) => {
      updateSessionsForProfile(get, set, profileId, (connection) => ({
        ...connection,
        status: 'building',
        phase: phase,
        tablesDone: tablesDone,
        tablesTotal: tablesTotal,
      }))
    },

    _handleComplete: (profileId) => {
      updateSessionsForProfile(get, set, profileId, (connection) => ({
        ...connection,
        status: 'ready',
        phase: null,
        lastBuildTimestamp: Date.now(),
      }))
    },

    _handleError: (profileId, error) => {
      updateSessionsForProfile(get, set, profileId, (connection) => ({
        ...connection,
        status: 'error',
        phase: null,
        error: error,
      }))
    },
  }
})
