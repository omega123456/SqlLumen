import { logFrontend } from '../../lib/app-log-commands'
import { showErrorToast } from '../toast-store'
import { getSessionSnapshot, type SnapshotTrigger } from '../../lib/session-snapshot-commands'
import type { SessionState } from '../../lib/session-restore-commands'
import { buildSessionState, useSessionRestoreStore } from '../session-restore-store'
import { normalizeActiveConnectionOrder, useConnectionStore } from '../connection-store'
import { toErrorMessage } from '../../lib/error-message'
import { useSnapshotStore } from '../snapshot-store'
import { buildRecoveryState } from './snapshot-metadata'

const RESTORE_FAILED_TITLE = 'Restore failed'

async function loadSnapshotSessionState(id: number): Promise<SessionState | null> {
  const stateJson = await getSessionSnapshot(id)
  if (!stateJson) {
    showErrorToast(RESTORE_FAILED_TITLE, 'This snapshot could not be found.')
    return null
  }

  try {
    return JSON.parse(stateJson) as SessionState
  } catch (error) {
    const message = toErrorMessage(error)
    logFrontend('error', `[snapshot] Failed to parse snapshot ${id} state: ${message}`)
    showErrorToast(RESTORE_FAILED_TITLE, 'This snapshot is corrupted and cannot be restored.')
    return null
  }
}

interface PreRestoreSession {
  connectionIds: string[]
  state: SessionState | null
}

function capturePreRestoreSession(): PreRestoreSession {
  const connectionStore = useConnectionStore.getState()
  const connectionIds = normalizeActiveConnectionOrder(
    connectionStore.activeConnectionOrder,
    connectionStore.activeConnections
  )
  const hasActiveConnections = connectionIds.length > 0
  return {
    connectionIds: connectionIds,
    state: hasActiveConnections ? buildSessionState() : null,
  }
}

async function saveSafetySnapshot(
  preRestore: PreRestoreSession,
  createAutoSnapshot: (trigger: SnapshotTrigger) => Promise<number | null>
): Promise<boolean> {
  const hasNoConnectionsToClose = preRestore.connectionIds.length === 0
  if (hasNoConnectionsToClose) {
    return true
  }
  const beforeRestoreSnapshotId = await createAutoSnapshot('beforeRestore')
  if (beforeRestoreSnapshotId != null) {
    return true
  }
  showErrorToast(
    RESTORE_FAILED_TITLE,
    'Could not create the safety snapshot. The current session was left unchanged.'
  )
  return false
}

interface ForceCloseOutcome {
  closedConnectionIds: string[]
  closeFailureId: string | null
}

async function forceCloseInOrder(connectionIds: string[]): Promise<ForceCloseOutcome> {
  const closedConnectionIds: string[] = []
  for (const sessionId of connectionIds) {
    const closed = await useConnectionStore.getState().closeConnection(sessionId, { force: true })
    if (!closed) {
      return { closedConnectionIds: closedConnectionIds, closeFailureId: sessionId }
    }
    closedConnectionIds.push(sessionId)
  }
  return { closedConnectionIds: closedConnectionIds, closeFailureId: null }
}

async function replayPreRestoreSession(
  preRestore: PreRestoreSession,
  closedConnectionIds: string[]
): Promise<void> {
  if (!preRestore.state) {
    return
  }
  const recoveryState = buildRecoveryState(
    preRestore.state,
    preRestore.connectionIds,
    closedConnectionIds
  )
  if (recoveryState) {
    await useSessionRestoreStore.getState().restoreFromState(recoveryState)
  }
}

function describeIncompleteClose(closeFailureId: string | null, stillOpenIds: string[]): string {
  if (closeFailureId != null) {
    return ` Failed while force-closing ${closeFailureId}.`
  }
  if (stillOpenIds.length > 0) {
    return ` Remaining open connections: ${stillOpenIds.join(', ')}.`
  }
  return ''
}

async function closeAllConnectionsBeforeRestore(preRestore: PreRestoreSession): Promise<boolean> {
  const outcome = await forceCloseInOrder(preRestore.connectionIds)
  const remainingConnections = useConnectionStore.getState().activeConnections
  const isStillOpen = (sessionId: string) => sessionId in remainingConnections
  const stillOpenTargetIds = preRestore.connectionIds.filter(isStillOpen)
  const hasClosedEveryTarget = !outcome.closeFailureId && stillOpenTargetIds.length === 0
  if (hasClosedEveryTarget) {
    return true
  }

  const confirmedClosedIds = outcome.closedConnectionIds.filter(
    (sessionId) => !isStillOpen(sessionId)
  )
  await replayPreRestoreSession(preRestore, confirmedClosedIds)

  const detail = describeIncompleteClose(outcome.closeFailureId, stillOpenTargetIds)
  logFrontend(
    'error',
    `[snapshot] Restore aborted because not all connections closed before restore.${detail}`
  )
  showErrorToast(
    RESTORE_FAILED_TITLE,
    'Could not close all open connections. The current session was restored.'
  )
  return false
}

export async function restoreSnapshot(id: number): Promise<void> {
  if (useSnapshotStore.getState().isRestoring) {
    return
  }
  useSnapshotStore.setState({ isBusy: true, isRestoring: true })
  try {
    const sessionRestoreStore = useSessionRestoreStore.getState()
    if (sessionRestoreStore.isRestoring) {
      const message = 'Session restore is already in progress. Please wait and try again.'
      logFrontend(
        'warn',
        `[snapshot] Restore blocked while session restore is already in progress.`
      )
      showErrorToast('Restore failed', message)
      return
    }

    const parsedState = await loadSnapshotSessionState(id)
    if (!parsedState) {
      return
    }

    const preRestore = capturePreRestoreSession()
    const isSafetySnapshotSaved = await saveSafetySnapshot(
      preRestore,
      useSnapshotStore.getState().createAutoSnapshot
    )
    if (!isSafetySnapshotSaved) {
      return
    }

    const isFullyClosed = await closeAllConnectionsBeforeRestore(preRestore)
    if (!isFullyClosed) {
      return
    }

    await useSessionRestoreStore.getState().restoreFromState(parsedState)

    useSnapshotStore.getState().closeDialog()
  } catch (error) {
    const message = toErrorMessage(error)
    logFrontend('error', `[snapshot] Failed to restore snapshot ${id}: ${message}`)
    showErrorToast('Restore failed', message)
  } finally {
    useSnapshotStore.setState({ isBusy: false, isRestoring: false })
  }
}
