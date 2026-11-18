import { create } from 'zustand'
import { listen } from '@tauri-apps/api/event'
import {
  listConnections,
  listConnectionGroups,
  openConnection as openConnectionIPC,
} from '../lib/connection-commands'
import type {
  SavedConnection,
  ConnectionGroup,
  ActiveConnection,
  ConnectionStatusEvent,
  OpenConnectionSession,
} from '../types/connection'
import { useWorkspaceStore } from './workspace-store'
import { useSchemaIndexStore } from './schema-index-store'
import { showErrorToast, showSuccessToast } from './toast-store'
import { hasTauriApis } from '../lib/tauri-env'
import { bootstrapSchemaCache } from '../lib/schema-cache-bootstrap'
import { logFrontend, logFrontendError, logFrontendWarning } from '../lib/app-log-commands'
import { toErrorMessage } from '../lib/error-message'
import { isIndexInBounds } from '../lib/value-checks'
import {
  isConnectionOfProfile,
  normalizeActiveConnectionOrder,
} from './connection-store/active-connections'
import {
  attachActiveConnection,
  normalizeConnectionOrder,
  recordLastConnected,
  reorderActiveConnections,
  setConnectionStatus,
} from './connection-store/connection-reducers'
import { closeAllConnections, closeConnection } from './connection-store/connection-close'
import { setActiveDatabase, updateDefaultDatabase } from './connection-store/connection-database'
import { connectionsWithUnsavedEdits } from './connection-store/unsaved-edits-before-close'

export { isConnectionOfProfile, normalizeActiveConnectionOrder }

let listenersSetup = false

export function _resetListenersSetup() {
  listenersSetup = false
}

export type SavedConnectionsLoad =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'failed'; message: string }

export interface OpenConnectionOptions {
  openQueryTab?: boolean
  password?: string
  toastOnFailure?: boolean
}

export interface ConnectionState {
  savedConnections: SavedConnection[]
  connectionGroups: ConnectionGroup[]
  savedConnectionsLoad: SavedConnectionsLoad

  activeConnections: Record<string, ActiveConnection>
  activeConnectionOrder: string[]
  activeTabId: string | null

  error: string | null

  fetchSavedConnections: () => Promise<void>
  openConnection: (id: string, options?: OpenConnectionOptions) => Promise<void>
  attachExistingConnection: (session: OpenConnectionSession) => boolean
  closeConnection: (id: string, options?: { force?: boolean }) => Promise<boolean>
  closeAllConnections: (options?: { force?: boolean }) => Promise<boolean>
  connectionsWithUnsavedEdits: () => string[]
  switchTab: (id: string) => void
  reorderActiveConnection: (id: string, insertIndex: number) => void
  moveActiveConnection: (id: string, direction: 'left' | 'right') => void
  normalizeActiveConnectionOrder: () => void
  updateConnectionStatus: (event: ConnectionStatusEvent) => void
  clearError: () => void
  setActiveDatabase: (sessionId: string, databaseName: string) => Promise<void>
  updateDefaultDatabase: (sessionId: string, newDefaultDb: string | null) => Promise<void>
  setupEventListeners: () => Promise<(() => void) | undefined>
}

const SAVED_CONNECTIONS_READY: SavedConnectionsLoad = { status: 'ready' }
const SAVED_CONNECTIONS_LOADING: SavedConnectionsLoad = { status: 'loading' }

function loadingUnlessReady(load: SavedConnectionsLoad): SavedConnectionsLoad {
  if (load.status === 'ready') return load
  return SAVED_CONNECTIONS_LOADING
}

async function fetchSavedConnections(): Promise<void> {
  useConnectionStore.setState((state) => ({
    savedConnectionsLoad: loadingUnlessReady(state.savedConnectionsLoad),
  }))
  try {
    const [connections, groups] = await Promise.all([listConnections(), listConnectionGroups()])
    useConnectionStore.setState({
      savedConnections: connections,
      connectionGroups: groups,
      savedConnectionsLoad: SAVED_CONNECTIONS_READY,
      error: null,
    })
  } catch (error) {
    const message = toErrorMessage(error)
    useConnectionStore.setState({
      savedConnectionsLoad: { status: 'failed', message: message },
      error: message,
    })
    showErrorToast('Failed to load connections', message)
  }
}

async function openConnection(id: string, options?: OpenConnectionOptions): Promise<void> {
  const profile = useConnectionStore
    .getState()
    .savedConnections.find((connection) => connection.id === id)
  if (!profile) {
    const errorMessage = `Connection profile '${id}' not found`
    useConnectionStore.setState({ error: errorMessage })
    showErrorToast('Connection failed', errorMessage)
    throw new Error(errorMessage)
  }

  try {
    const result = await openConnectionIPC(id, options?.password)
    useConnectionStore.setState((state) =>
      recordLastConnected(state, { profileId: id, lastConnectedAt: result.lastConnectedAt })
    )
    useConnectionStore.getState().attachExistingConnection({
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

    const schemaIndexStore = useSchemaIndexStore.getState()
    schemaIndexStore.triggerBuild(result.sessionId).catch((error) => {
      const message = toErrorMessage(error)
      logFrontendError('[connection-store] Schema index build failed:', message)
    })
  } catch (error) {
    const errorMessage = toErrorMessage(error)
    useConnectionStore.setState({ error: errorMessage })
    if (options?.toastOnFailure !== false) showErrorToast('Connection failed', errorMessage)
    throw error
  }
}

function attachExistingConnection(session: OpenConnectionSession): boolean {
  if (useConnectionStore.getState().activeConnections[session.sessionId]) {
    return true
  }

  const profile = useConnectionStore
    .getState()
    .savedConnections.find((connection) => connection.id === session.profileId)
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

  useConnectionStore.setState((state) => attachActiveConnection(state, active))
  useWorkspaceStore.getState().openHistoryTab(session.sessionId, false)
  useWorkspaceStore.getState().openProcessListTab(session.sessionId)
  useWorkspaceStore.getState().setVisibleConnectionSession(session.sessionId)

  bootstrapSchemaCache(session.sessionId, session.profileId).catch((error) => {
    const message = toErrorMessage(error)
    logFrontend('warn', `[connection-store] Schema cache bootstrap failed: ${message}`)
  })
  useSchemaIndexStore.getState().registerSession(session.sessionId, session.profileId)
  return true
}

function switchTab(id: string): void {
  useConnectionStore.setState({ activeTabId: id })
  useWorkspaceStore.getState().setVisibleConnectionSession(id)
}

function reorderActiveConnection(id: string, insertIndex: number): void {
  useConnectionStore.setState((state) =>
    reorderActiveConnections(state, { sessionId: id, insertIndex: insertIndex })
  )
}

function moveActiveConnection(id: string, direction: 'left' | 'right'): void {
  const orderedIds = normalizeActiveConnectionOrder(
    useConnectionStore.getState().activeConnectionOrder,
    useConnectionStore.getState().activeConnections
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
  useConnectionStore.getState().reorderActiveConnection(id, insertIndex)
}

function normalizeStoredConnectionOrder(): void {
  useConnectionStore.setState(normalizeConnectionOrder)
}

function updateConnectionStatus(event: ConnectionStatusEvent): void {
  useConnectionStore.setState((state) => setConnectionStatus(state, event))
}

function clearError(): void {
  return useConnectionStore.setState({ error: null })
}

async function setupEventListeners(): Promise<(() => void) | undefined> {
  if (listenersSetup) return undefined
  listenersSetup = true

  if (!hasTauriApis()) {
    return undefined
  }

  try {
    const unlisten = await listen<ConnectionStatusEvent>('connection-status-changed', (event) => {
      useConnectionStore.getState().updateConnectionStatus(event.payload)
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
}

export const useConnectionStore = create<ConnectionState>()(() => ({
  savedConnections: [],
  connectionGroups: [],
  savedConnectionsLoad: { status: 'idle' },
  activeConnections: {},
  activeConnectionOrder: [],
  activeTabId: null,
  error: null,
  fetchSavedConnections: fetchSavedConnections,
  openConnection: openConnection,
  attachExistingConnection: attachExistingConnection,
  closeConnection: closeConnection,
  closeAllConnections: closeAllConnections,
  connectionsWithUnsavedEdits: connectionsWithUnsavedEdits,
  switchTab: switchTab,
  reorderActiveConnection: reorderActiveConnection,
  moveActiveConnection: moveActiveConnection,
  normalizeActiveConnectionOrder: normalizeStoredConnectionOrder,
  updateConnectionStatus: updateConnectionStatus,
  clearError: clearError,
  setActiveDatabase: setActiveDatabase,
  updateDefaultDatabase: updateDefaultDatabase,
  setupEventListeners: setupEventListeners,
}))

export function useIsConnectionReadOnly(connectionId: string): boolean {
  return useConnectionStore(
    (state) => state.activeConnections[connectionId]?.profile?.readOnly ?? false
  )
}
