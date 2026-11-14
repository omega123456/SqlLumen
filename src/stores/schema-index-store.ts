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

export type BuildPhase = 'loading_schema' | 'embedding' | 'finalizing'

export interface ConnectionIndexState {
  status: SchemaIndexStatus['status']
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
  connections: Record<string, ConnectionIndexState>
  profileToSessions: Record<string, string[]>
  sessionToProfile: Record<string, string>

  registerSession: (sessionId: string, profileId: string) => void
  unregisterSession: (sessionId: string) => void
  triggerBuild: (sessionId: string) => Promise<void>
  forceRebuild: (sessionId: string) => Promise<void>
  triggerInvalidation: (sessionId: string, tables: string[]) => Promise<void>
  getStatusForSession: (sessionId: string) => ConnectionIndexState | undefined

  _handleProgress: (progress: SchemaIndexProgress) => void
  _handleComplete: (profileId: string) => void
  _handleError: (profileId: string, error: string) => void
}

let settingsUnsub: (() => void) | null = null

export function _resetSchemaIndexStoreForTest(): void {
  settingsUnsub?.()
  settingsUnsub = null
}

function updateSessionsForProfile(
  profileId: string,
  update: (connection: ConnectionIndexState) => ConnectionIndexState
): void {
  const sessions = useSchemaIndexStore.getState().profileToSessions[profileId] ?? []
  if (sessions.length === 0) return

  useSchemaIndexStore.setState((state) =>
    updateSessions(state, { sessionIds: sessions, update: update })
  )
}

let listenersInitialized = false

function initEventListeners(): void {
  if (listenersInitialized) return
  if (!hasTauriApis()) return
  listenersInitialized = true

  listen<SchemaIndexProgress>('schema-index-progress', (event) => {
    useSchemaIndexStore.getState()._handleProgress(event.payload)
  }).catch((error) => {
    logFrontendError('[schema-index-store] Failed to listen for schema-index-progress:', error)
  })

  listen<{ profileId: string; tablesIndexed: number; durationMs: number }>(
    'schema-index-complete',
    (event) => {
      useSchemaIndexStore.getState()._handleComplete(event.payload.profileId)
    }
  ).catch((error) => {
    logFrontendError('[schema-index-store] Failed to listen for schema-index-complete:', error)
  })

  listen<{ profileId: string; error: string }>('schema-index-error', (event) => {
    useSchemaIndexStore.getState()._handleError(event.payload.profileId, event.payload.error)
  }).catch((error) => {
    logFrontendError('[schema-index-store] Failed to listen for schema-index-error:', error)
  })
}

function initSettingsSubscription(): void {
  if (settingsUnsub) return

  let previousEmbeddingModel = useSettingsStore.getState().getSetting('ai.embeddingModel')

  settingsUnsub = useSettingsStore.subscribe((state) => {
    const currentModel = state.getSetting('ai.embeddingModel')
    if (currentModel !== previousEmbeddingModel) {
      previousEmbeddingModel = currentModel

      const store = useSchemaIndexStore.getState()
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

function registerSession(sessionId: string, profileId: string): void {
  initEventListeners()
  initSettingsSubscription()

  useSchemaIndexStore.setState((state) =>
    registerIndexSession(state, { sessionId: sessionId, profileId: profileId })
  )

  getIndexStatus(sessionId)
    .then((status) => {
      useSchemaIndexStore.setState((state) =>
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
}

function unregisterSession(sessionId: string): void {
  useSchemaIndexStore.setState((state) => unregisterIndexSession(state, sessionId))

  const hasNoSessions = Object.keys(useSchemaIndexStore.getState().sessionToProfile).length === 0
  if (hasNoSessions && settingsUnsub) {
    settingsUnsub()
    settingsUnsub = null
  }
}

async function triggerBuild(sessionId: string): Promise<void> {
  const state = useSchemaIndexStore.getState()
  const profileId = state.sessionToProfile[sessionId]
  if (!profileId) {
    return
  }

  const siblingSessionIds = state.profileToSessions[profileId] ?? []
  for (const sid of siblingSessionIds) {
    if (sid === sessionId) continue
    const siblingConnection = state.connections[sid]
    if (isBuildingOrReady(siblingConnection)) {
      useSchemaIndexStore.setState((current) =>
        adoptSiblingBuild(current, { sessionId: sessionId, sibling: siblingConnection })
      )
      return
    }
  }

  useSchemaIndexStore.setState((current) => markIndexBuilding(current, sessionId))

  try {
    await buildSchemaIndex(sessionId)

    try {
      const realStatus = await getIndexStatus(sessionId)
      useSchemaIndexStore.setState((current) =>
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

    useSchemaIndexStore.setState((current) =>
      markIndexBuildFailed(current, { sessionId: sessionId, message: message })
    )
  }
}

async function forceRebuild(sessionId: string): Promise<void> {
  const state = useSchemaIndexStore.getState()
  if (!state.sessionToProfile[sessionId]) {
    return
  }

  useSchemaIndexStore.setState((current) => markIndexBuilding(current, sessionId))

  try {
    await forceRebuildSchemaIndex(sessionId)

    try {
      const realStatus = await getIndexStatus(sessionId)
      useSchemaIndexStore.setState((current) =>
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
    logFrontend('error', `[schema-index-store] Force rebuild failed for ${sessionId}: ${message}`)

    useSchemaIndexStore.setState((current) =>
      markIndexBuildFailed(current, { sessionId: sessionId, message: message })
    )
  }
}

async function triggerInvalidation(sessionId: string, tables: string[]): Promise<void> {
  try {
    await invalidateSchemaIndex(sessionId, tables)
  } catch (error) {
    const message = toErrorMessage(error)
    logFrontendError('[schema-index-store] Failed to invalidate index:', message)
    logFrontend('warn', `[schema-index-store] Invalidation failed for ${sessionId}: ${message}`)
  }
}

function getStatusForSession(sessionId: string): ConnectionIndexState | undefined {
  return useSchemaIndexStore.getState().connections[sessionId]
}

function _handleProgress({ profileId, phase, tablesDone, tablesTotal }: SchemaIndexProgress): void {
  updateSessionsForProfile(profileId, (connection) => ({
    ...connection,
    status: 'building',
    phase: phase,
    tablesDone: tablesDone,
    tablesTotal: tablesTotal,
  }))
}

function _handleComplete(profileId: string): void {
  updateSessionsForProfile(profileId, (connection) => ({
    ...connection,
    status: 'ready',
    phase: null,
    lastBuildTimestamp: Date.now(),
  }))
}

function _handleError(profileId: string, error: string): void {
  updateSessionsForProfile(profileId, (connection) => ({
    ...connection,
    status: 'error',
    phase: null,
    error: error,
  }))
}

export const useSchemaIndexStore = create<SchemaIndexStore>()(() => ({
  connections: {},
  profileToSessions: {},
  sessionToProfile: {},
  registerSession: registerSession,
  unregisterSession: unregisterSession,
  triggerBuild: triggerBuild,
  forceRebuild: forceRebuild,
  triggerInvalidation: triggerInvalidation,
  getStatusForSession: getStatusForSession,
  _handleProgress: _handleProgress,
  _handleComplete: _handleComplete,
  _handleError: _handleError,
}))
