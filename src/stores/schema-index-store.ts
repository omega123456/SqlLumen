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
import {
  adoptSiblingBuild,
  isBuildingOrReady,
  markIndexBuildFailed,
  markIndexBuilding,
  registerIndexSession,
  setReportedIndexStatus,
  settleTriggeredBuildStatus,
  unregisterIndexSession,
  updateSessions,
} from './schema-index-store/schema-index-reducers'

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

export interface SchemaIndexProgress {
  profileId: string
  phase: BuildPhase
  tablesDone: number
  tablesTotal: number
}

export interface SchemaIndexStore {
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
  _handleProgress: (progress: SchemaIndexProgress) => void
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
// Store
// ---------------------------------------------------------------------------

export const useSchemaIndexStore = create<SchemaIndexStore>()((set, get) => {
  const updateSessionsForProfile = (
    profileId: string,
    update: (connection: ConnectionIndexState) => ConnectionIndexState
  ): void => {
    const sessions = get().profileToSessions[profileId] ?? []
    if (sessions.length === 0) return

    set((state) => updateSessions(state, { sessionIds: sessions, update: update }))
  }

  // ------ Event listener setup (lazy, once) ------

  let listenersInitialized = false

  function initEventListeners(): void {
    if (listenersInitialized) return
    if (!hasTauriApis()) return
    listenersInitialized = true

    listen<SchemaIndexProgress>('schema-index-progress', (event) => {
      get()._handleProgress(event.payload)
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

      set((state) => registerIndexSession(state, { sessionId: sessionId, profileId: profileId }))

      // Query the real backend status asynchronously (fire-and-forget)
      getIndexStatus(sessionId)
        .then((status) => {
          set((state) =>
            setReportedIndexStatus(state, { sessionId: sessionId, status: status.status })
          )
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
      set((state) => unregisterIndexSession(state, sessionId))

      const hasNoSessions = Object.keys(get().sessionToProfile).length === 0
      if (hasNoSessions && settingsUnsub) {
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
        if (isBuildingOrReady(siblingConnection)) {
          set((current) =>
            adoptSiblingBuild(current, { sessionId: sessionId, sibling: siblingConnection })
          )
          return
        }
      }

      set((current) => markIndexBuilding(current, sessionId))

      try {
        await buildSchemaIndex(sessionId)

        // After triggering, check actual backend status.
        // The backend may have returned early (e.g. not_configured) without emitting events.
        try {
          const realStatus = await getIndexStatus(sessionId)
          set((current) =>
            settleTriggeredBuildStatus(current, {
              sessionId: sessionId,
              status: realStatus.status,
            })
          )
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

        set((current) => markIndexBuildFailed(current, { sessionId: sessionId, message: message }))
      }
    },

    forceRebuild: async (sessionId) => {
      const state = get()
      if (!state.sessionToProfile[sessionId]) {
        return
      }

      set((current) => markIndexBuilding(current, sessionId))

      try {
        await forceRebuildSchemaIndex(sessionId)

        // After triggering, check actual backend status.
        // The backend may have returned early (e.g. not_configured) without emitting events.
        try {
          const realStatus = await getIndexStatus(sessionId)
          set((current) =>
            settleTriggeredBuildStatus(current, {
              sessionId: sessionId,
              status: realStatus.status,
            })
          )
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

        set((current) => markIndexBuildFailed(current, { sessionId: sessionId, message: message }))
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

    _handleProgress: ({ profileId, phase, tablesDone, tablesTotal }) => {
      updateSessionsForProfile(profileId, (connection) => ({
        ...connection,
        status: 'building',
        phase: phase,
        tablesDone: tablesDone,
        tablesTotal: tablesTotal,
      }))
    },

    _handleComplete: (profileId) => {
      updateSessionsForProfile(profileId, (connection) => ({
        ...connection,
        status: 'ready',
        phase: null,
        lastBuildTimestamp: Date.now(),
      }))
    },

    _handleError: (profileId, error) => {
      updateSessionsForProfile(profileId, (connection) => ({
        ...connection,
        status: 'error',
        phase: null,
        error: error,
      }))
    },
  }
})
