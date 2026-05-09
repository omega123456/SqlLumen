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
import { useSchemaIndexStore } from './schema-index-store'
import { useProcessListStore } from './processlist-store'
import { showErrorToast, showSuccessToast } from './toast-store'
import { invalidateCache } from '../components/query-editor/schema-metadata-cache'
import { invalidateRoutineCache } from '../components/query-editor/routine-parameter-cache'
import { hasTauriApis } from '../lib/tauri-env'

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
  openConnection: (id: string) => Promise<void>
  closeConnection: (id: string) => Promise<void>
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
        activeConnectionOrder: normalizeActiveConnectionOrder(
          [...state.activeConnectionOrder, result.sessionId],
          { ...state.activeConnections, [result.sessionId]: active }
        ),
        activeTabId: result.sessionId,
        error: null,
      }))
      useWorkspaceStore.getState().openHistoryTab(result.sessionId, false)
      useWorkspaceStore.getState().openProcessListTab(result.sessionId)
      showSuccessToast('Connected', profile.name)

      // Register session for schema index and trigger initial build (fire-and-forget)
      const schemaIndexStore = useSchemaIndexStore.getState()
      schemaIndexStore.registerSession(result.sessionId, id)
      schemaIndexStore.triggerBuild(result.sessionId).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[connection-store] Schema index build failed:', msg)
      })
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
      useSchemaIndexStore.getState().unregisterSession(id)
      useProcessListStore.getState().resetConnection(id)
      invalidateCache(id)
      invalidateRoutineCache(id)

      set((state) => {
        const orderedIdsBeforeClose = normalizeActiveConnectionOrder(
          state.activeConnectionOrder,
          state.activeConnections
        )
        const closedIndex = orderedIdsBeforeClose.indexOf(id)
        const remaining = { ...state.activeConnections }
        delete remaining[id]
        const remainingIds = normalizeActiveConnectionOrder(
          state.activeConnectionOrder.filter((sessionId) => sessionId !== id),
          remaining
        )
        const fallbackIndex =
          closedIndex >= 0 ? Math.min(closedIndex, Math.max(remainingIds.length - 1, 0)) : 0
        const newActiveTabId =
          state.activeTabId === id
            ? remainingIds.length > 0
              ? remainingIds[fallbackIndex]
              : null
            : state.activeTabId

        return {
          activeConnections: remaining,
          activeConnectionOrder: remainingIds,
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
    if (targetIndex < 0 || targetIndex >= orderedIds.length) {
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

    if (!hasTauriApis()) {
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

export function normalizeActiveConnectionOrder(
  activeConnectionOrder: string[],
  activeConnections: Record<string, ActiveConnection>
): string[] {
  const orderedIds: string[] = []
  const seen = new Set<string>()

  for (const sessionId of activeConnectionOrder) {
    if (!activeConnections[sessionId] || seen.has(sessionId)) {
      continue
    }
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
