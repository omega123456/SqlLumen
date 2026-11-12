import { logFrontend } from '../lib/app-log-commands'
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
import type {
  SessionState,
  SessionConnectionState,
  SessionTabState,
} from '../lib/session-restore-commands'
import { saveSessionState, loadSessionState } from '../lib/session-restore-commands'
import { listOpenConnectionSessions } from '../lib/connection-commands'
import { hasTauriApis } from '../lib/tauri-env'
import { MILLISECONDS_PER_MINUTE } from '../lib/units'
import type { WorkspaceTab } from '../types/schema'
import type { OpenConnectionSession } from '../types/connection'
import { toErrorMessage } from '../lib/error-message'

const SESSION_AUTOSAVE_INTERVAL_MINUTES = 5
export const SESSION_AUTOSAVE_INTERVAL_MS =
  SESSION_AUTOSAVE_INTERVAL_MINUTES * MILLISECONDS_PER_MINUTE

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
interface SaveSessionWaiter {
  resolve: () => void
  reject: (error: Error) => void
}

const saveSessionWaiters = new Map<number, SaveSessionWaiter>()
let loadTauriWindowApi: LoadTauriWindowApi = defaultLoadTauriWindowApi

/**
 * Hooks invoked during the window-close flow, after the session state has been
 * saved and before the window is destroyed. Used by other stores (e.g. the
 * snapshot store) to run close-time work without `session-restore-store`
 * depending on them (avoids an import cycle).
 */
const preCloseHooks: Array<() => Promise<void>> = []

/**
 * Register a hook to run during the window-close flow. Hooks run after the
 * session-state save and before the window is destroyed. A failing hook is
 * logged but must never block window destruction.
 */
export function registerPreCloseHook(hook: () => Promise<void>): void {
  preCloseHooks.push(hook)
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface SessionRestoreState {
  /** True while restoring session on app launch. */
  isRestoring: boolean
  /** Error message if restore failed. */
  restoreError: string | null
  /** True when a saved connection did not restore. */
  hasIncompleteRestore: boolean

  // Actions
  saveSession: (options?: SaveSessionOptions) => Promise<void>
  restoreSession: () => Promise<void>
  /** Apply a session state directly (used by both launch-restore and snapshot-restore). */
  restoreFromState: (state: SessionState) => Promise<void>
  isEnabled: () => boolean
  canPersistSession: () => boolean
}

export const useSessionRestoreStore = create<SessionRestoreState>()((set, get) => ({
  isRestoring: false,
  restoreError: null,
  hasIncompleteRestore: false,

  isEnabled: (): boolean => {
    return useSettingsStore.getState().getSetting('session.restore') === 'true'
  },

  canPersistSession: (): boolean => !get().isRestoring && !get().hasIncompleteRestore,

  saveSession: async (options?: SaveSessionOptions): Promise<void> => {
    if (!get().isEnabled() || !get().canPersistSession()) {
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

    await waitForSave.catch((error: unknown) => {
      logFrontend(
        'debug',
        `[session-restore] Session save failed for a caller that does not rethrow: ${String(error)}`
      )
    })
  },

  restoreSession: async (): Promise<void> => {
    if (!get().isEnabled()) {
      return
    }

    try {
      const state = await loadSessionState()
      if (!state) {
        set({ hasIncompleteRestore: false })
        return
      }

      await get().restoreFromState(state)
    } catch (error) {
      const message = toErrorMessage(error)
      set({ restoreError: message, hasIncompleteRestore: true })
      logFrontend('error', `[session-restore] Failed to load saved session: ${message}`)
      showErrorToast('Session restore failed', 'The saved workspace was retained.')
    }
  },

  restoreFromState: async (state: SessionState): Promise<void> => {
    // Guard against concurrent calls (React StrictMode double-invokes effects
    // in dev, which would otherwise open each connection twice).
    if (get().isRestoring) {
      return
    }

    if (!state || state.connections.length === 0) {
      set({ hasIncompleteRestore: false })
      return
    }

    set({ isRestoring: true, restoreError: null, hasIncompleteRestore: true })
    let beganRestore = false

    try {
      beganRestore = true
      useWorkspaceStore.getState().resetStackRecency()

      const [, openSessions] = await Promise.all([
        useConnectionStore.getState().fetchSavedConnections(),
        listOpenConnectionSessions(),
      ])
      const outcome = await restoreSavedConnections(state, openSessions)
      const restoredCount = outcome.restoredCount
      attachUnclaimedSessions(openSessions, outcome.claimedSessionIds)
      switchToRestoredConnection(state.activeConnectionIndex, outcome.restoredSessionIds)

      useWorkspaceStore.getState().resetStackRecency()
      const hasIncompleteRestore = restoredCount !== state.connections.length
      set({ hasIncompleteRestore })
      if (hasIncompleteRestore) {
        logFrontend(
          'warn',
          `[session-restore] Restored ${restoredCount} of ${state.connections.length} saved connections. Automatic persistence is paused; the saved workspace was retained.`
        )
      }
    } catch (error) {
      const message = toErrorMessage(error)
      logFrontend(
        'error',
        `[session-restore] Restoration stopped: ${message}. Automatic persistence is paused; the saved workspace was retained.`
      )
      set({ restoreError: message, hasIncompleteRestore: true })
      showErrorToast('Session restore failed', 'The saved workspace was retained.')
    } finally {
      if (beganRestore) {
        useWorkspaceStore.getState().resetStackRecency()
      }
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
    } catch (caughtError) {
      error = caughtError instanceof Error ? caughtError : new Error(String(caughtError))
      const message = error.message
      logFrontend('error', `[session-restore] Failed to save session state: ${message}`)
    }

    saveSessionCompletedRequestId = requestId

    for (const completedRequestId of [...saveSessionWaiters.keys()].sort(
      (left, right) => left - right
    )) {
      if (completedRequestId > requestId) {
        continue
      }

      const waiter = saveSessionWaiters.get(completedRequestId)
      if (!waiter) {
        continue
      }

      saveSessionWaiters.delete(completedRequestId)
      settleSaveWaiter(waiter, error)
    }
  }
}

export function buildSessionState(): SessionState {
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

    const serializedTabs = tabs
      .map((tab) => serializeTab(tab, queryStore))
      .filter((serialized): serialized is SessionTabState => serialized !== null)
    const activeTabIndex = activeTabIndexOf(serializedTabs, activeTabId)

    connections.push({
      profileId: profileId,
      activeTabIndex: activeTabIndex,
      tabs: serializedTabs,
    })
  }

  return {
    version: 1,
    connections: connections,
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
    case 'query-editor':
      return serializeQueryEditorTab(tab, queryStore)
    case 'table-data':
      return {
        type: 'table-data',
        tabId: tab.id,
        databaseName: tab.databaseName,
        tableName: tab.objectName,
        parentQueryTabId: tab.parentQueryTabId,
        objectType: tab.objectType === 'view' ? 'view' : 'table',
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
  const profile = store.savedConnections.find((connection) => connection.id === profileId)
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
    await store.openConnection(profileId, { openQueryTab: false })
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

function attachExistingSession(session: OpenConnectionSession): string | null {
  if (useConnectionStore.getState().attachExistingConnection(session)) {
    return session.sessionId
  }

  logFrontend(
    'warn',
    `[session-restore] Saved profile ${session.profileId} was not found for open session ${session.sessionId}`
  )
  return null
}

type SavedTableDataTab = Extract<SessionTabState, { type: 'table-data' }>
type SavedSchemaInfoTab = Extract<SessionTabState, { type: 'schema-info' }>
type SavedQueryEditorTab = Extract<SessionTabState, { type: 'query-editor' }>
type QueryStoreState = ReturnType<(typeof useQueryStore)['getState']>

interface TabRestoreContext {
  sessionId: string
  bottomPanelEnabled: boolean
  savedToRuntimeTabId: Map<string, string>
  queryBottomPanelSelections: Map<string, string>
}

function groupSessionsByProfile(
  openSessions: OpenConnectionSession[]
): Map<string, OpenConnectionSession[]> {
  const sessionsByProfile = new Map<string, OpenConnectionSession[]>()
  for (const session of openSessions) {
    const sessions = sessionsByProfile.get(session.profileId) ?? []
    sessions.push(session)
    sessionsByProfile.set(session.profileId, sessions)
  }
  return sessionsByProfile
}

interface ConnectionsRestoreOutcome {
  restoredCount: number
  restoredSessionIds: Array<string | null>
  claimedSessionIds: Set<string>
}

async function restoreSavedConnections(
  state: SessionState,
  openSessions: OpenConnectionSession[]
): Promise<ConnectionsRestoreOutcome> {
  const sessionsByProfile = groupSessionsByProfile(openSessions)
  const outcome: ConnectionsRestoreOutcome = {
    restoredCount: 0,
    restoredSessionIds: Array.from({ length: state.connections.length }, () => null),
    claimedSessionIds: new Set<string>(),
  }
  for (const [savedIndex, connectionState] of state.connections.entries()) {
    try {
      const existingSession = sessionsByProfile.get(connectionState.profileId)?.shift()
      if (existingSession) {
        outcome.claimedSessionIds.add(existingSession.sessionId)
      }
      const sessionId = await resolveRestoreSessionId(existingSession, connectionState.profileId)
      if (!sessionId) continue
      await restoreConnectionTabs(sessionId, connectionState)
      outcome.restoredSessionIds[savedIndex] = sessionId
      outcome.restoredCount += 1
    } catch (error) {
      reportConnectionRestoreFailure(connectionState.profileId, error)
    }
  }
  return outcome
}

function attachUnclaimedSessions(
  openSessions: OpenConnectionSession[],
  claimedSessionIds: Set<string>
): void {
  for (const session of openSessions) {
    if (!claimedSessionIds.has(session.sessionId)) {
      attachExistingSession(session)
    }
  }
}

function reportConnectionRestoreFailure(profileId: string, error: unknown): void {
  const message = toErrorMessage(error)
  logFrontend('error', `[session-restore] Failed to restore connection ${profileId}: ${message}`)
  showErrorToast('Session restore failed', `Could not reconnect: ${message}`)
}

async function resolveRestoreSessionId(
  existingSession: OpenConnectionSession | undefined,
  profileId: string
): Promise<string | null> {
  if (existingSession) return attachExistingSession(existingSession)
  return connectByProfileId(profileId)
}

function switchToRestoredConnection(
  activeConnectionIndex: number | undefined,
  restoredSessionIds: Array<string | null>
): void {
  if (typeof activeConnectionIndex !== 'number') return
  const activeSessionId = restoredSessionIds[activeConnectionIndex] ?? null
  if (activeSessionId) {
    useConnectionStore.getState().switchTab(activeSessionId)
  }
}

function settleSaveWaiter(waiter: SaveSessionWaiter, error: Error | null): void {
  if (error) {
    waiter.reject(error)
    return
  }
  waiter.resolve()
}

function activeTabIndexOf(serializedTabs: SessionTabState[], activeTabId: string | null): number {
  if (!activeTabId) return 0
  const index = serializedTabs.findIndex((serialized) => serialized.tabId === activeTabId)
  return Math.max(index, 0)
}

function serializeQueryEditorTab(
  tab: WorkspaceTab,
  queryStore: QueryStoreState
): SavedQueryEditorTab {
  const tabState = queryStore.tabs[tab.id]
  const bottomPanelItem = tabState?.activeBottomPanelItem
  return {
    type: 'query-editor',
    tabId: tab.id,
    sql: tabState?.content ?? '',
    cursorLine: tabState?.cursorPosition?.lineNumber,
    cursorColumn: tabState?.cursorPosition?.column,
    label: tab.label,
    activeBottomPanelTableTabId:
      bottomPanelItem?.type === 'table-data' ? bottomPanelItem.tabId : undefined,
  }
}

function restoreQueryEditorTab(context: TabRestoreContext, tabState: SavedQueryEditorTab): void {
  const queryStore = useQueryStore.getState()
  const runtimeTabId = useWorkspaceStore.getState().openQueryTab(context.sessionId, tabState.label)
  context.savedToRuntimeTabId.set(tabState.tabId, runtimeTabId)
  if (tabState.sql) {
    queryStore.setContent(runtimeTabId, tabState.sql)
  }
  if (tabState.cursorLine != null && tabState.cursorColumn != null) {
    queryStore.setCursorPosition(runtimeTabId, {
      lineNumber: tabState.cursorLine,
      column: tabState.cursorColumn,
    })
  }
  if (tabState.activeBottomPanelTableTabId) {
    context.queryBottomPanelSelections.set(runtimeTabId, tabState.activeBottomPanelTableTabId)
  }
}

function restoreTableDataTab(context: TabRestoreContext, tabState: SavedTableDataTab): string {
  const restoredTabId = useWorkspaceStore.getState().restoreTableDataTab({
    type: 'table-data',
    label: tabState.tableName,
    connectionId: context.sessionId,
    databaseName: tabState.databaseName,
    objectName: tabState.tableName,
    objectType: tabState.objectType ?? 'table',
    // The saved scope stays until the post-pass remaps it, so same-table children keep apart.
    parentQueryTabId: tabState.parentQueryTabId,
  })
  context.savedToRuntimeTabId.set(tabState.tabId, restoredTabId)
  return restoredTabId
}

function sessionTabs(sessionId: string): WorkspaceTab[] {
  return useWorkspaceStore.getState().tabsByConnection[sessionId] ?? []
}

function rememberRestoredTab(
  context: TabRestoreContext,
  savedTabId: string,
  restoredTab: WorkspaceTab | undefined
): string | null {
  if (!restoredTab) return null
  context.savedToRuntimeTabId.set(savedTabId, restoredTab.id)
  return restoredTab.id
}

function restoreSchemaInfoTab(context: TabRestoreContext, tabState: SavedSchemaInfoTab) {
  useWorkspaceStore.getState().openTab({
    type: 'schema-info',
    label: tabState.objectName,
    connectionId: context.sessionId,
    databaseName: tabState.databaseName,
    objectName: tabState.objectName,
    objectType: tabState.objectType as
      'table' | 'view' | 'procedure' | 'function' | 'trigger' | 'event',
  })
  const created = sessionTabs(context.sessionId).find(
    (tab) =>
      tab.type === 'schema-info' &&
      tab.databaseName === tabState.databaseName &&
      tab.objectName === tabState.objectName
  )
  return rememberRestoredTab(context, tabState.tabId, created)
}

function restoreHistoryTab(context: TabRestoreContext, tabState: SessionTabState): string | null {
  const workspaceStore = useWorkspaceStore.getState()
  workspaceStore.openHistoryTab(context.sessionId, false)
  const created = sessionTabs(context.sessionId).find((tab) => tab.type === 'history')
  const restoredTabId = rememberRestoredTab(context, tabState.tabId, created)
  workspaceStore.openProcessListTab(context.sessionId)
  return restoredTabId
}

function restoreSavedTab(context: TabRestoreContext, tabState: SessionTabState): string | null {
  if (tabState.type === 'query-editor') {
    return context.savedToRuntimeTabId.get(tabState.tabId) ?? null
  }
  if (tabState.type === 'table-data') return restoreTableDataTab(context, tabState)
  if (tabState.type === 'schema-info') return restoreSchemaInfoTab(context, tabState)
  if (tabState.type === 'history') return restoreHistoryTab(context, tabState)
  return null
}

function savedTableTabFor(
  savedTabs: SessionTabState[],
  context: TabRestoreContext,
  runtimeTabId: string
): SavedTableDataTab | undefined {
  return savedTabs.find(
    (savedTab): savedTab is SavedTableDataTab =>
      savedTab.type === 'table-data' &&
      context.savedToRuntimeTabId.get(savedTab.tabId) === runtimeTabId
  )
}

function restoredParentQueryTabId(
  context: TabRestoreContext,
  savedTableTab: SavedTableDataTab | undefined
): string | undefined {
  const savedParentId = savedTableTab?.parentQueryTabId
  if (!context.bottomPanelEnabled || !savedParentId) return undefined
  return context.savedToRuntimeTabId.get(savedParentId)
}

function orderRestoredTabs(
  runtimeTabs: WorkspaceTab[],
  savedTabs: SessionTabState[],
  context: TabRestoreContext
): WorkspaceTab[] {
  const orderedRuntimeTabIds = savedTabs
    .map((savedTab) => context.savedToRuntimeTabId.get(savedTab.tabId) ?? null)
    .filter((tabId): tabId is string => tabId != null)
  const savedOrderTabs = orderedRuntimeTabIds
    .map((tabId) => runtimeTabs.find((tab) => tab.id === tabId) ?? null)
    .filter((tab): tab is WorkspaceTab => tab != null)
  const unsavedTabs = runtimeTabs.filter((tab) => !orderedRuntimeTabIds.includes(tab.id))
  return [...savedOrderTabs, ...unsavedTabs].map((tab) => {
    if (tab.type !== 'table-data') return tab
    const savedTableTab = savedTableTabFor(savedTabs, context, tab.id)
    return { ...tab, parentQueryTabId: restoredParentQueryTabId(context, savedTableTab) }
  })
}

function isScopedChildOf(tab: WorkspaceTab | undefined, queryTabId: string): boolean {
  return tab?.type === 'table-data' && tab.parentQueryTabId === queryTabId
}

function applyBottomPanelSelections(context: TabRestoreContext): void {
  for (const [runtimeQueryTabId, savedTableTabId] of context.queryBottomPanelSelections) {
    const runtimeTableTabId = context.savedToRuntimeTabId.get(savedTableTabId)
    if (!runtimeTableTabId) continue
    const runtimeTableTab = sessionTabs(context.sessionId).find(
      (tab) => tab.id === runtimeTableTabId
    )
    if (!isScopedChildOf(runtimeTableTab, runtimeQueryTabId)) continue
    useQueryStore.getState().setActiveBottomPanelItem(runtimeQueryTabId, {
      type: 'table-data',
      tabId: runtimeTableTabId,
    })
  }
}

function activateFlattenedTableTab(
  context: TabRestoreContext,
  savedActiveTab: SessionTabState | null
): void {
  if (context.bottomPanelEnabled || savedActiveTab?.type !== 'table-data') return
  const flattenedActiveTable = sessionTabs(context.sessionId).find(
    (tab) =>
      tab.type === 'table-data' &&
      tab.databaseName === savedActiveTab.databaseName &&
      tab.objectName === savedActiveTab.tableName
  )
  if (flattenedActiveTable) {
    useWorkspaceStore.getState().setActiveTab(context.sessionId, flattenedActiveTable.id)
  }
}

function activateRestoredTab(
  context: TabRestoreContext,
  activeTabId: string,
  savedActiveTab: SessionTabState | null
): void {
  const activeTab = sessionTabs(context.sessionId).find((tab) => tab.id === activeTabId)
  if (!activeTab) {
    activateFlattenedTableTab(context, savedActiveTab)
    return
  }
  if (activeTab.type !== 'table-data' || !activeTab.parentQueryTabId) {
    useWorkspaceStore.getState().setActiveTab(context.sessionId, activeTabId)
    return
  }
  useWorkspaceStore.getState().setActiveTab(context.sessionId, activeTab.parentQueryTabId)
  useQueryStore.getState().setActiveBottomPanelItem(activeTab.parentQueryTabId, {
    type: 'table-data',
    tabId: activeTab.id,
  })
}

function savedActiveTabOf(connectionState: SessionConnectionState): SessionTabState | null {
  if (connectionState.activeTabIndex < 0) return null
  return connectionState.tabs[connectionState.activeTabIndex] ?? null
}

/**
 * Restore tabs for a given connection session.
 */
async function restoreConnectionTabs(
  sessionId: string,
  connectionState: SessionConnectionState
): Promise<void> {
  const context: TabRestoreContext = {
    sessionId: sessionId,
    bottomPanelEnabled:
      useSettingsStore.getState().getSetting('results.tableTabsInBottomPanel') === 'true',
    savedToRuntimeTabId: new Map<string, string>(),
    queryBottomPanelSelections: new Map<string, string>(),
  }
  const savedActiveTab = savedActiveTabOf(connectionState)

  for (const tabState of connectionState.tabs) {
    if (tabState.type === 'query-editor') {
      restoreQueryEditorTab(context, tabState)
    }
  }

  let activeTabId: string | null = null
  for (const [tabIndex, tabState] of connectionState.tabs.entries()) {
    const restoredTabId = restoreSavedTab(context, tabState)
    if (tabIndex === connectionState.activeTabIndex && restoredTabId) {
      activeTabId = restoredTabId
    }
  }

  useWorkspaceStore.setState((state) => ({
    tabsByConnection: {
      ...state.tabsByConnection,
      [sessionId]: orderRestoredTabs(
        state.tabsByConnection[sessionId] ?? [],
        connectionState.tabs,
        context
      ),
    },
  }))

  applyBottomPanelSelections(context)

  if (!context.bottomPanelEnabled) {
    useWorkspaceStore.getState().normalizeTableDataTabScopes()
  }

  if (activeTabId) {
    activateRestoredTab(context, activeTabId, savedActiveTab)
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
  preCloseHooks.length = 0
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
      } catch (error) {
        const message = toErrorMessage(error)
        showErrorToast('Session save failed', 'Could not save the current session before closing.')
        logFrontend('error', `[session-restore] Error saving session on close: ${message}`)
        return
      }

      // Run registered pre-close hooks (e.g. snapshot creation). A failing hook
      // must never block window destruction.
      for (const hook of preCloseHooks) {
        try {
          await hook()
        } catch (error) {
          const message = toErrorMessage(error)
          logFrontend('error', `[session-restore] Pre-close hook failed: ${message}`)
        }
      }

      await appWindow.destroy()
    })
    closeHandlerRegistered = true
  } catch (error) {
    const message = toErrorMessage(error)
    logFrontend('warn', `[session-restore] Failed to register close handler: ${message}`)
  }
}
