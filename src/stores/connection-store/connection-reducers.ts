import { clampedInsertIndex, movedToInsertIndex } from '../../lib/list-reorder'
import type {
  ActiveConnection,
  ConnectionStatusEvent,
  SavedConnection,
} from '../../types/connection'
import type { ConnectionState } from '../connection-store'
import { isConnectionOfProfile, normalizeActiveConnectionOrder } from './active-connections'

type ActiveConnections = Pick<ConnectionState, 'activeConnections'>
type OrderedConnections = ActiveConnections & Pick<ConnectionState, 'activeConnectionOrder'>
type ProfiledConnections = ActiveConnections & Pick<ConnectionState, 'savedConnections'>
type AttachedConnection = OrderedConnections & Pick<ConnectionState, 'activeTabId' | 'error'>

export interface ActiveConnectionMove {
  sessionId: string
  insertIndex: number
}

export interface SessionDatabaseChange {
  sessionId: string
  sessionDatabase: string | null
}

function withActiveConnection(
  state: ActiveConnections,
  connection: ActiveConnection
): ActiveConnections {
  return { activeConnections: { ...state.activeConnections, [connection.id]: connection } }
}

export function attachActiveConnection(
  state: OrderedConnections,
  connection: ActiveConnection
): AttachedConnection {
  const { activeConnections } = withActiveConnection(state, connection)
  const activeConnectionOrder = normalizeActiveConnectionOrder(
    [...state.activeConnectionOrder, connection.id],
    activeConnections
  )
  return {
    activeConnections: activeConnections,
    activeConnectionOrder: activeConnectionOrder,
    activeTabId: connection.id,
    error: null,
  }
}

export function normalizeConnectionOrder(
  state: OrderedConnections
): Pick<ConnectionState, 'activeConnectionOrder'> {
  return {
    activeConnectionOrder: normalizeActiveConnectionOrder(
      state.activeConnectionOrder,
      state.activeConnections
    ),
  }
}

export function reorderActiveConnections(
  state: OrderedConnections,
  { sessionId, insertIndex }: ActiveConnectionMove
): OrderedConnections | Pick<ConnectionState, 'activeConnectionOrder'> {
  const { activeConnectionOrder } = normalizeConnectionOrder(state)
  const sourceIndex = activeConnectionOrder.indexOf(sessionId)
  if (sourceIndex < 0) return state
  const move = {
    sourceIndex: sourceIndex,
    insertIndex: clampedInsertIndex(insertIndex, activeConnectionOrder.length),
  }
  return { activeConnectionOrder: movedToInsertIndex(activeConnectionOrder, move) }
}

export function setConnectionStatus(
  state: ActiveConnections,
  event: ConnectionStatusEvent
): ActiveConnections {
  const existing = state.activeConnections[event.connectionId]
  if (!existing) return state
  return withActiveConnection(state, { ...existing, status: event.status })
}

export function setSessionDatabase(
  state: ActiveConnections,
  { sessionId, sessionDatabase }: SessionDatabaseChange
): ActiveConnections {
  const connection = { ...state.activeConnections[sessionId], sessionDatabase: sessionDatabase }
  return { activeConnections: { ...state.activeConnections, [sessionId]: connection } }
}

function withProfile(connection: ActiveConnection, profile: SavedConnection): ActiveConnection {
  if (!isConnectionOfProfile(connection, profile.id)) return connection
  return { ...connection, profile: profile }
}

function withDefaultDatabaseOf(saved: SavedConnection, profile: SavedConnection): SavedConnection {
  if (saved.id !== profile.id) return saved
  return { ...saved, defaultDatabase: profile.defaultDatabase }
}

export function applyProfileDefaultDatabase(
  state: ProfiledConnections,
  profile: SavedConnection
): ProfiledConnections {
  const activeEntries = Object.entries(state.activeConnections).map(([sessionId, connection]) => [
    sessionId,
    withProfile(connection, profile),
  ])
  return {
    activeConnections: Object.fromEntries(activeEntries),
    savedConnections: state.savedConnections.map((saved) => withDefaultDatabaseOf(saved, profile)),
  }
}
