import { logFrontend } from '../../lib/app-log-commands'
import { useConnectionStore } from '../connection-store'
import { showErrorToast } from '../toast-store'
import type { SessionConnectionState, SessionState } from '../../lib/session-restore-commands'
import type { OpenConnectionSession } from '../../types/connection'
import { toErrorMessage } from '../../lib/error-message'
import { restoreConnectionTabs } from './session-tab-restore'

async function connectByProfileId(profileId: string): Promise<string | null> {
  const store = useConnectionStore.getState()

  const profile = store.savedConnections.find((connection) => connection.id === profileId)
  if (!profile) {
    logFrontend(
      'warn',
      `[session-restore] Profile ${profileId} not found in saved connections, skipping`
    )
    return null
  }

  const existingSessionIds = new Set(Object.keys(store.activeConnections))

  try {
    await store.openConnection(profileId, { openQueryTab: false })
  } catch {
    return null
  }

  const updatedStore = useConnectionStore.getState()
  for (const sessionId of Object.keys(updatedStore.activeConnections)) {
    if (!existingSessionIds.has(sessionId)) {
      return sessionId
    }
  }

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

interface SavedConnectionsRestore {
  sessionsByProfile: Map<string, OpenConnectionSession[]>
  outcome: ConnectionsRestoreOutcome
}

interface SavedConnectionEntry {
  savedIndex: number
  connectionState: SessionConnectionState
}

async function restoreSavedConnection(
  { sessionsByProfile, outcome }: SavedConnectionsRestore,
  { savedIndex, connectionState }: SavedConnectionEntry
): Promise<void> {
  const existingSession = sessionsByProfile.get(connectionState.profileId)?.shift()
  if (existingSession) {
    outcome.claimedSessionIds.add(existingSession.sessionId)
  }
  const sessionId = await resolveRestoreSessionId(existingSession, connectionState.profileId)
  if (!sessionId) return
  await restoreConnectionTabs(sessionId, connectionState)
  outcome.restoredSessionIds[savedIndex] = sessionId
  outcome.restoredCount += 1
}

export async function restoreSavedConnections(
  state: SessionState,
  openSessions: OpenConnectionSession[]
): Promise<ConnectionsRestoreOutcome> {
  const sessionsByProfile = groupSessionsByProfile(openSessions)
  const outcome: ConnectionsRestoreOutcome = {
    restoredCount: 0,
    restoredSessionIds: Array.from({ length: state.connections.length }, () => null),
    claimedSessionIds: new Set<string>(),
  }
  const restore = { sessionsByProfile: sessionsByProfile, outcome: outcome }
  for (const [savedIndex, connectionState] of state.connections.entries()) {
    try {
      await restoreSavedConnection(restore, { savedIndex, connectionState })
    } catch (error) {
      reportConnectionRestoreFailure(connectionState.profileId, error)
    }
  }
  return outcome
}

export function attachUnclaimedSessions(
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

export function switchToRestoredConnection(
  activeConnectionIndex: number | undefined,
  restoredSessionIds: Array<string | null>
): void {
  if (typeof activeConnectionIndex !== 'number') return
  const activeSessionId = restoredSessionIds[activeConnectionIndex] ?? null
  if (activeSessionId) {
    useConnectionStore.getState().switchTab(activeSessionId)
  }
}
