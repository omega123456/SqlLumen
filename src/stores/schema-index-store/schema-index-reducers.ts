import type { SchemaIndexStatus } from '../../lib/schema-index-commands'
import type { ConnectionIndexState, SchemaIndexStore } from '../schema-index-store'
import { withoutKey } from '../../lib/record-utils'

type IndexConnections = Pick<SchemaIndexStore, 'connections'>
type SessionRegistry = Pick<
  SchemaIndexStore,
  'connections' | 'profileToSessions' | 'sessionToProfile'
>

export interface SessionRegistration {
  sessionId: string
  profileId: string
}

export interface SessionsUpdate {
  sessionIds: string[]
  update: (connection: ConnectionIndexState) => ConnectionIndexState
}

export interface SessionIndexStatus {
  sessionId: string
  status: SchemaIndexStatus['status']
}

export interface SiblingBuildAdoption {
  sessionId: string
  sibling: ConnectionIndexState
}

export interface SessionBuildFailure {
  sessionId: string
  message: string
}

export function createDefaultConnectionIndexState(): ConnectionIndexState {
  return {
    status: 'stale',
    phase: null,
    tablesDone: 0,
    tablesTotal: 0,
    lastBuildTimestamp: 0,
  }
}

export function isBuildingOrReady(
  connection: ConnectionIndexState | undefined
): connection is ConnectionIndexState {
  if (!connection) return false
  return connection.status === 'building' || connection.status === 'ready'
}

function isBuildingOrStale(connection: ConnectionIndexState): boolean {
  return connection.status === 'building' || connection.status === 'stale'
}

function connectionOrDefault(state: IndexConnections, sessionId: string): ConnectionIndexState {
  return state.connections[sessionId] ?? createDefaultConnectionIndexState()
}

function withConnection(
  state: IndexConnections,
  sessionId: string,
  connection: ConnectionIndexState
): IndexConnections {
  return { connections: { ...state.connections, [sessionId]: connection } }
}

function patchConnectionOrDefault(
  state: IndexConnections,
  sessionId: string,
  partial: Partial<ConnectionIndexState>
): IndexConnections {
  return withConnection(state, sessionId, { ...connectionOrDefault(state, sessionId), ...partial })
}

export function updateSessions(
  state: IndexConnections,
  { sessionIds, update }: SessionsUpdate
): IndexConnections {
  const connections = { ...state.connections }
  for (const sessionId of sessionIds) {
    connections[sessionId] = update(connectionOrDefault(state, sessionId))
  }
  return { connections: connections }
}

export function registerIndexSession(
  state: SessionRegistry,
  { sessionId, profileId }: SessionRegistration
): SessionRegistry {
  const profileSessions = [...(state.profileToSessions[profileId] ?? []), sessionId]
  return {
    ...withConnection(state, sessionId, createDefaultConnectionIndexState()),
    profileToSessions: { ...state.profileToSessions, [profileId]: profileSessions },
    sessionToProfile: { ...state.sessionToProfile, [sessionId]: profileId },
  }
}

function profileSessionsWithout(
  state: SessionRegistry,
  { sessionId, profileId }: SessionRegistration
): Record<string, string[]> {
  const remainingSessions = (state.profileToSessions[profileId] ?? []).filter(
    (otherSessionId) => otherSessionId !== sessionId
  )
  const otherProfiles = withoutKey(state.profileToSessions, profileId)
  if (remainingSessions.length === 0) return otherProfiles
  return { ...otherProfiles, [profileId]: remainingSessions }
}

export function unregisterIndexSession(state: SessionRegistry, sessionId: string): SessionRegistry {
  const profileId = state.sessionToProfile[sessionId]
  if (!profileId) return state
  const registration = { sessionId: sessionId, profileId: profileId }
  return {
    connections: withoutKey(state.connections, sessionId),
    profileToSessions: profileSessionsWithout(state, registration),
    sessionToProfile: withoutKey(state.sessionToProfile, sessionId),
  }
}

export function setReportedIndexStatus(
  state: IndexConnections,
  { sessionId, status }: SessionIndexStatus
): IndexConnections {
  const connection = state.connections[sessionId]
  if (!connection) return state
  return withConnection(state, sessionId, { ...connection, status: status })
}

export function settleTriggeredBuildStatus(
  state: IndexConnections,
  sessionStatus: SessionIndexStatus
): IndexConnections {
  const connection = state.connections[sessionStatus.sessionId]
  if (!connection) return state
  if (!isBuildingOrStale(connection)) return state
  return setReportedIndexStatus(state, sessionStatus)
}

export function adoptSiblingBuild(
  state: IndexConnections,
  { sessionId, sibling }: SiblingBuildAdoption
): IndexConnections {
  return patchConnectionOrDefault(state, sessionId, {
    status: sibling.status,
    phase: sibling.phase,
    tablesDone: sibling.tablesDone,
    tablesTotal: sibling.tablesTotal,
    lastBuildTimestamp: sibling.lastBuildTimestamp,
  })
}

export function markIndexBuilding(state: IndexConnections, sessionId: string): IndexConnections {
  return patchConnectionOrDefault(state, sessionId, {
    status: 'building',
    phase: null,
    tablesDone: 0,
    tablesTotal: 0,
  })
}

export function markIndexBuildFailed(
  state: IndexConnections,
  { sessionId, message }: SessionBuildFailure
): IndexConnections {
  return patchConnectionOrDefault(state, sessionId, { status: 'error', error: message })
}
