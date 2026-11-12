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
  OpenConnectionSession,
} from '../types/connection'
import type { WorkspaceTab } from '../types/schema'
import { useSchemaStore } from './schema-store'
import { useWorkspaceStore } from './workspace-store'
import { useQueryStore } from './query-store'
import { useTableDataStore } from './table-data-store'
import { useObjectEditorStore } from './object-editor-store'
import { useSchemaIndexStore } from './schema-index-store'
import { useProcessListStore } from './processlist-store'
import { showErrorToast, showSuccessToast } from './toast-store'
import { invalidateCache } from '../components/query-editor/schema-metadata-cache'
import { invalidateRoutineCache } from '../components/query-editor/routine-parameter-cache'
import { hasTauriApis } from '../lib/tauri-env'
import { bootstrapSchemaCache } from '../lib/schema-cache-bootstrap'

import { logFrontend, logFrontendError, logFrontendWarning } from '../lib/app-log-commands'
import { toErrorMessage } from '../lib/error-message'
import { hasModifiedColumns } from '../lib/row-edit-state'
import { isIndexInBounds } from '../lib/value-checks'
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
  activeConnectionOrder: string[]
  activeTabId: string | null

  // Dialog state
  dialogOpen: boolean

  // Error state
  error: string | null

  // Actions
  fetchSavedConnections: () => Promise<void>
  /**
   * Connect with a saved profile. A new connection starts with one blank query tab unless
   * `openQueryTab` is false (session restore brings back the saved tabs instead).
   */
  openConnection: (id: string, options?: { openQueryTab?: boolean }) => Promise<void>
  attachExistingConnection: (session: OpenConnectionSession) => boolean
  closeConnection: (id: string, options?: { force?: boolean }) => Promise<boolean>
  closeAllConnections: (options?: { force?: boolean }) => Promise<boolean>
  connectionsWithUnsavedEdits: () => string[]
  switchTab: (id: string) => void
  reorderActiveConnection: (id: string, insertIndex: number) => void
  moveActiveConnection: (id: string, direction: 'left' | 'right') => void
  normalizeActiveConnectionOrder: () => void
  updateConnectionStatus: (event: ConnectionStatusEvent) => void
  openDialog: () => void
  closeDialog: () => void
  clearError: () => void
  setActiveDatabase: (sessionId: string, databaseName: string) => Promise<void>
  updateDefaultDatabase: (sessionId: string, newDefaultDb: string | null) => Promise<void>
  setupEventListeners: () => Promise<(() => void) | undefined>
}

const UNSAVED_EDITS_NOT_SAVED_TITLE = 'Connection not closed'
const UNSAVED_EDITS_NOT_SAVED_MESSAGE =
  'Could not save pending edits. Fix or discard changes before closing.'

function isConnectionOfProfile(connection: ActiveConnection, profileId: string): boolean {
  return connection.profile.id === profileId
}

async function saveRowBeforeClose(save: () => Promise<boolean>): Promise<boolean> {
  const saved = await save()
  if (!saved) {
    showErrorToast(UNSAVED_EDITS_NOT_SAVED_TITLE, UNSAVED_EDITS_NOT_SAVED_MESSAGE)
  }
  return saved
}

async function settleQueryEditorTabBeforeClose(tabId: string): Promise<boolean> {
  const queryTabState = useQueryStore.getState().tabs[tabId]
  if (!queryTabState?.results) return true

  const activeIndex = queryTabState.activeResultIndex ?? 0
  const hasNonActiveDirty = queryTabState.results.some(
    (result, index) => index !== activeIndex && hasModifiedColumns(result.editState)
  )
  if (hasNonActiveDirty) {
    const confirmed = globalThis.confirm(
      'You have unsaved changes in non-active query results. Close connection anyway? Unsaved changes will be lost.'
    )
    if (!confirmed) return false
  }

  const activeResult = queryTabState.results[activeIndex]
  if (!hasModifiedColumns(activeResult?.editState)) return true
  return saveRowBeforeClose(() => useQueryStore.getState().saveCurrentRow(tabId))
}

async function settleTableDataTabBeforeClose(tabId: string): Promise<boolean> {
  const tableDataTabState = useTableDataStore.getState().tabs[tabId]
  if (!hasModifiedColumns(tableDataTabState?.editState)) return true
  return saveRowBeforeClose(() => useTableDataStore.getState().saveCurrentRow(tabId))
}

const SETTLE_TAB_BEFORE_CLOSE: Partial<
  Record<WorkspaceTab['type'], (tabId: string) => Promise<boolean>>
> = {
  'query-editor': settleQueryEditorTabBeforeClose,
  'table-data': settleTableDataTabBeforeClose,
}

function confirmDiscardingObjectEditorChanges(workspaceTabs: WorkspaceTab[]): boolean {
  const objectEditorState = useObjectEditorStore.getState()
  const hasDirtyObjectEditorTab = workspaceTabs.some(
    (tab) => tab.type === 'object-editor' && objectEditorState.isDirty(tab.id)
  )
  if (!hasDirtyObjectEditorTab) return true
  return globalThis.confirm(
    'You have unsaved changes in object editor tabs. Close connection anyway?'
  )
}

async function settleUnsavedEditsBeforeClose(connectionId: string): Promise<boolean> {
  const workspaceTabs = useWorkspaceStore.getState().tabsByConnection[connectionId] ?? []
  for (const tab of workspaceTabs) {
    const settleTab = SETTLE_TAB_BEFORE_CLOSE[tab.type]
    if (!settleTab) continue
    const isSettled = await settleTab(tab.id)
    if (!isSettled) return false
  }
  return confirmDiscardingObjectEditorChanges(workspaceTabs)
}

interface ConnectionSelection {
  activeConnections: Record<string, ActiveConnection>
  activeConnectionOrder: string[]
  activeTabId: string | null
}

function resolveFallbackTabId(remainingIds: string[], closedIndex: number): string | null {
  if (remainingIds.length === 0) return null
  if (closedIndex < 0) return remainingIds[0]
  return remainingIds[Math.min(closedIndex, remainingIds.length - 1)]
}

function resolveSelectionAfterClose(
  state: ConnectionSelection,
  closedId: string
): ConnectionSelection {
  const orderedIdsBeforeClose = normalizeActiveConnectionOrder(
    state.activeConnectionOrder,
    state.activeConnections
  )
  const closedIndex = orderedIdsBeforeClose.indexOf(closedId)
  const remaining = { ...state.activeConnections }
  delete remaining[closedId]
  const remainingIds = normalizeActiveConnectionOrder(
    state.activeConnectionOrder.filter((sessionId) => sessionId !== closedId),
    remaining
  )
  const isClosingActiveTab = state.activeTabId === closedId
  return {
    activeConnections: remaining,
    activeConnectionOrder: remainingIds,
    activeTabId: isClosingActiveTab
      ? resolveFallbackTabId(remainingIds, closedIndex)
      : state.activeTabId,
  }
}

function clearClosedConnectionState(connectionId: string): void {
  useSchemaStore.getState().clearConnectionState(connectionId)
  useWorkspaceStore.getState().clearConnectionTabs(connectionId)
  useSchemaIndexStore.getState().unregisterSession(connectionId)
  useProcessListStore.getState().resetConnection(connectionId)
  invalidateCache(connectionId)
  invalidateRoutineCache(connectionId)
}

export const useConnectionStore = create<ConnectionState>()((set, get) => ({
  savedConnections: [],
  connectionGroups: [],
  activeConnections: {},
  activeConnectionOrder: [],
  activeTabId: null,
  dialogOpen: false,
  error: null,

  fetchSavedConnections: async () => {
    try {
      const [connections, groups] = await Promise.all([listConnections(), listConnectionGroups()])
      set({ savedConnections: connections, connectionGroups: groups, error: null })
    } catch (error) {
      const message = toErrorMessage(error)
      set({ error: message })
      showErrorToast('Failed to load connections', message)
    }
  },

  openConnection: async (id: string, options) => {
    const profile = get().savedConnections.find((connection) => connection.id === id)
    if (!profile) {
      const errorMessage = `Connection profile '${id}' not found`
      set({ error: errorMessage })
      showErrorToast('Connection failed', errorMessage)
      throw new Error(errorMessage)
    }

    try {
      const result = await openConnectionIPC(id)
      get().attachExistingConnection({
        sessionId: result.sessionId,
        profileId: id,
        status: 'connected',
        serverVersion: result.serverVersion,
        sessionDatabase: profile.defaultDatabase,
      })
      if (options?.openQueryTab !== false) {
        useWorkspaceStore.getState().openQueryTab(result.sessionId)
      }
      showSuccessToast('Connected', profile.name)

      // Register session for schema index and trigger initial build (fire-and-forget)
      const schemaIndexStore = useSchemaIndexStore.getState()
      schemaIndexStore.triggerBuild(result.sessionId).catch((error) => {
        const message = toErrorMessage(error)
        logFrontendError('[connection-store] Schema index build failed:', message)
      })
    } catch (error) {
      const errorMessage = toErrorMessage(error)
      set({ error: errorMessage })
      showErrorToast('Connection failed', errorMessage)
      throw error
    }
  },

  attachExistingConnection: (session) => {
    if (get().activeConnections[session.sessionId]) {
      return true
    }

    const profile = get().savedConnections.find((connection) => connection.id === session.profileId)
    if (!profile) {
      return false
    }

    const active: ActiveConnection = {
      id: session.sessionId,
      profile: profile,
      sessionDatabase: session.sessionDatabase,
      status: session.status,
      serverVersion: session.serverVersion,
    }

    set((state) => {
      const activeConnections = { ...state.activeConnections, [session.sessionId]: active }
      return {
        activeConnections: activeConnections,
        activeConnectionOrder: normalizeActiveConnectionOrder(
          [...state.activeConnectionOrder, session.sessionId],
          activeConnections
        ),
        activeTabId: session.sessionId,
        error: null,
      }
    })
    useWorkspaceStore.getState().openHistoryTab(session.sessionId, false)
    useWorkspaceStore.getState().openProcessListTab(session.sessionId)
    useWorkspaceStore.getState().setVisibleConnectionSession(session.sessionId)

    bootstrapSchemaCache(session.sessionId, session.profileId).catch((error) => {
      const message = toErrorMessage(error)
      logFrontend('warn', `[connection-store] Schema cache bootstrap failed: ${message}`)
    })
    useSchemaIndexStore.getState().registerSession(session.sessionId, session.profileId)
    return true
  },

  closeConnection: async (id: string, options?: { force?: boolean }) => {
    try {
      // When force-closing (e.g. snapshot restore), skip the unsaved-edit
      // handling entirely — the caller has already warned the user — and
      // proceed straight to closing the connection.
      if (!options?.force) {
        const isReadyToClose = await settleUnsavedEditsBeforeClose(id)
        if (!isReadyToClose) return false
      }

      await closeConnectionIPC(id)

      // Compute the fallback connection selection BEFORE clearing the closed
      // session's workspace state. This lets the workspace visibility
      // coordinator capture the previous visible session/surface and reveal the
      // fallback session before the closed session's tabs are removed.
      const selection = resolveSelectionAfterClose(get(), id)

      // Coordinate the visible workspace transition while the closed session's
      // workspace state is still intact, so deactivation context is preserved.
      // When the closed session was the visible connection, reveal the fallback
      // session (or clear visibility when no session remains).
      if (useWorkspaceStore.getState().visibleConnectionSessionId === id) {
        useWorkspaceStore.getState().setVisibleConnectionSession(selection.activeTabId ?? '')
      }

      clearClosedConnectionState(id)

      set({
        activeConnections: selection.activeConnections,
        activeConnectionOrder: selection.activeConnectionOrder,
        activeTabId: selection.activeTabId,
        error: null,
      })
      return true
    } catch (error) {
      const message = toErrorMessage(error)
      set({ error: message })
      showErrorToast('Failed to close connection', message)
      return false
    }
  },

  closeAllConnections: async (options?: { force?: boolean }) => {
    const sessionIds = normalizeActiveConnectionOrder(
      get().activeConnectionOrder,
      get().activeConnections
    )
    let allClosed = true
    for (const sessionId of sessionIds) {
      const closed = await get().closeConnection(sessionId, options)
      if (!closed) {
        allClosed = false
      }
    }
    return allClosed
  },

  connectionsWithUnsavedEdits: () => {
    const sessionIds = Object.keys(get().activeConnections)
    const queryTabs = useQueryStore.getState().tabs
    const tableDataTabs = useTableDataStore.getState().tabs
    const objectEditorState = useObjectEditorStore.getState()
    const dirtySessionIds: string[] = []

    for (const sessionId of sessionIds) {
      const workspaceTabs = useWorkspaceStore.getState().tabsByConnection[sessionId] ?? []
      const hasUnsaved = workspaceTabs.some((tab) => {
        if (tab.type === 'query-editor') {
          const queryTabState = queryTabs[tab.id]
          return (
            queryTabState?.results?.some((result) => hasModifiedColumns(result.editState)) ?? false
          )
        }
        if (tab.type === 'table-data') {
          const tableDataTabState = tableDataTabs[tab.id]
          return hasModifiedColumns(tableDataTabState?.editState)
        }
        if (tab.type === 'object-editor') {
          return objectEditorState.isDirty(tab.id)
        }
        return false
      })
      if (hasUnsaved) {
        dirtySessionIds.push(sessionId)
      }
    }

    return dirtySessionIds
  },

  switchTab: (id: string) => {
    set({ activeTabId: id })
    // The connection store is authoritative for the selected connection tab;
    // mirror the selection into the workspace store so it coordinates the
    // visible row-surface transition (old surface inactive, new surface active).
    useWorkspaceStore.getState().setVisibleConnectionSession(id)
  },

  reorderActiveConnection: (id: string, insertIndex: number) => {
    set((state) => {
      const orderedIds = normalizeActiveConnectionOrder(
        state.activeConnectionOrder,
        state.activeConnections
      )
      const fromIndex = orderedIds.indexOf(id)
      if (fromIndex < 0) {
        return state
      }
      const clampedInsertIndex = Math.max(0, Math.min(insertIndex, orderedIds.length))
      const next = [...orderedIds]
      next.splice(fromIndex, 1)
      const adjustedInsertIndex =
        fromIndex < clampedInsertIndex ? clampedInsertIndex - 1 : clampedInsertIndex
      next.splice(adjustedInsertIndex, 0, id)
      return {
        activeConnectionOrder: next,
      }
    })
  },

  moveActiveConnection: (id: string, direction: 'left' | 'right') => {
    const orderedIds = normalizeActiveConnectionOrder(
      get().activeConnectionOrder,
      get().activeConnections
    )
    const fromIndex = orderedIds.indexOf(id)
    if (fromIndex < 0) {
      return
    }
    const delta = direction === 'left' ? -1 : 1
    const targetIndex = fromIndex + delta
    if (!isIndexInBounds(targetIndex, orderedIds.length)) {
      return
    }
    const insertIndex = direction === 'right' ? targetIndex + 1 : targetIndex
    get().reorderActiveConnection(id, insertIndex)
  },

  normalizeActiveConnectionOrder: () => {
    set((state) => ({
      activeConnectionOrder: normalizeActiveConnectionOrder(
        state.activeConnectionOrder,
        state.activeConnections
      ),
    }))
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

    if (!active) return
    if (!trimmedName) return
    if (currentSessionDatabase === trimmedName) return

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
    } catch (error) {
      const message = toErrorMessage(error)
      showErrorToast('Failed to switch database', message)

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
        if (isConnectionOfProfile(next[sid], profileId)) {
          next[sid] = { ...next[sid], profile }
        }
      }
      return next
    }

    // Update in-memory optimistically (all sessions for this profile + saved list)
    set((state) => ({
      activeConnections: patchActivesForProfile(state, updatedProfile),
      savedConnections: state.savedConnections.map((connection) =>
        connection.id === profileId ? { ...connection, defaultDatabase: newDefaultDb } : connection
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
    } catch (error) {
      logFrontendError('Failed to persist defaultDatabase change:', error)
      const message = toErrorMessage(error)
      showErrorToast('Failed to save default database', message)
      const revertedProfile = { ...updatedProfile, defaultDatabase: originalDefault }
      const current = get().activeConnections[sessionId]
      if (current) {
        set((state) => ({
          activeConnections: patchActivesForProfile(state, revertedProfile),
          savedConnections: state.savedConnections.map((connection) =>
            connection.id === profileId
              ? { ...connection, defaultDatabase: originalDefault }
              : connection
          ),
        }))
      }
    }
  },

  setupEventListeners: async () => {
    if (listenersSetup) return undefined
    listenersSetup = true

    if (!hasTauriApis()) {
      return undefined
    }

    try {
      const unlisten = await listen<ConnectionStatusEvent>('connection-status-changed', (event) => {
        get().updateConnectionStatus(event.payload)
      })
      return unlisten
    } catch (error) {
      logFrontendWarning(
        '[connection-store] connection-status-changed listen failed (unexpected Tauri error):',
        error
      )
      listenersSetup = false
      return undefined
    }
  },
}))

export function normalizeActiveConnectionOrder(
  activeConnectionOrder: string[],
  activeConnections: Record<string, ActiveConnection>
): string[] {
  const orderedIds: string[] = []
  const seen = new Set<string>()

  for (const sessionId of activeConnectionOrder) {
    if (!activeConnections[sessionId]) continue
    if (seen.has(sessionId)) continue
    seen.add(sessionId)
    orderedIds.push(sessionId)
  }

  for (const sessionId of Object.keys(activeConnections)) {
    if (seen.has(sessionId)) {
      continue
    }
    seen.add(sessionId)
    orderedIds.push(sessionId)
  }

  return orderedIds
}

export function useIsConnectionReadOnly(connectionId: string): boolean {
  return useConnectionStore(
    (state) => state.activeConnections[connectionId]?.profile?.readOnly ?? false
  )
}
