import { logFrontend } from '../lib/app-log-commands'
import { create } from 'zustand'
import { useSettingsStore } from './settings-store'
import { useConnectionStore } from './connection-store'
import { useWorkspaceStore } from './workspace-store'
import { showErrorToast } from './toast-store'
import type { SessionState } from '../lib/session-restore-commands'
import { loadSessionState } from '../lib/session-restore-commands'
import { listOpenConnectionSessions } from '../lib/connection-commands'
import { toErrorMessage } from '../lib/error-message'
import {
  attachUnclaimedSessions,
  restoreSavedConnections,
  switchToRestoredConnection,
} from './session-restore-store/session-connections'
import { saveSession } from './session-restore-store/session-persistence'
import type { SaveSessionOptions } from './session-restore-store/session-persistence'
export {
  SESSION_AUTOSAVE_INTERVAL_MS,
  registerPreCloseHook,
  _resetSessionPersistenceForTests,
  _setLoadTauriWindowApiForTests,
  registerCloseHandler,
} from './session-restore-store/session-persistence'
export { buildSessionState } from './session-restore-store/session-serialization'

interface SessionRestoreState {
  isRestoring: boolean
  hasRestoreSettled: boolean
  restoreError: string | null
  hasIncompleteRestore: boolean

  saveSession: (options?: SaveSessionOptions) => Promise<void>
  restoreSession: () => Promise<void>
  restoreFromState: (state: SessionState) => Promise<void>
  isEnabled: () => boolean
  canPersistSession: () => boolean
}

function isEnabled(): boolean {
  return useSettingsStore.getState().getSetting('session.restore') === 'true'
}

function canPersistSession(): boolean {
  return (
    !useSessionRestoreStore.getState().isRestoring &&
    !useSessionRestoreStore.getState().hasIncompleteRestore
  )
}

async function restoreSession(): Promise<void> {
  try {
    await restoreEnabledSession()
  } finally {
    useSessionRestoreStore.setState({ hasRestoreSettled: true })
  }
}

async function restoreEnabledSession(): Promise<void> {
  if (!useSessionRestoreStore.getState().isEnabled()) {
    return
  }

  try {
    const state = await loadSessionState()
    if (!state) {
      useSessionRestoreStore.setState({ hasIncompleteRestore: false })
      return
    }

    await useSessionRestoreStore.getState().restoreFromState(state)
  } catch (error) {
    const message = toErrorMessage(error)
    useSessionRestoreStore.setState({ restoreError: message, hasIncompleteRestore: true })
    logFrontend('error', `[session-restore] Failed to load saved session: ${message}`)
    showErrorToast('Session restore failed', 'The saved workspace was retained.')
  }
}

async function restoreFromState(state: SessionState): Promise<void> {
  if (useSessionRestoreStore.getState().isRestoring) {
    return
  }

  const hasConnectionsToRestore = Boolean(state) && state.connections.length > 0
  if (!hasConnectionsToRestore) {
    useSessionRestoreStore.setState({ hasIncompleteRestore: false })
    return
  }

  useSessionRestoreStore.setState({
    isRestoring: true,
    restoreError: null,
    hasIncompleteRestore: true,
  })
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
    useSessionRestoreStore.setState({ hasIncompleteRestore })
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
    useSessionRestoreStore.setState({ restoreError: message, hasIncompleteRestore: true })
    showErrorToast('Session restore failed', 'The saved workspace was retained.')
  } finally {
    if (beganRestore) {
      useWorkspaceStore.getState().resetStackRecency()
    }
    useSessionRestoreStore.setState({ isRestoring: false })
  }
}

export const useSessionRestoreStore = create<SessionRestoreState>()(() => ({
  isRestoring: false,
  hasRestoreSettled: false,
  restoreError: null,
  hasIncompleteRestore: false,
  isEnabled: isEnabled,
  canPersistSession: canPersistSession,
  saveSession: saveSession,
  restoreSession: restoreSession,
  restoreFromState: restoreFromState,
}))
