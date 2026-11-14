import { updateConnection as updateConnectionIPC } from '../../lib/connection-commands'
import { selectDatabase as selectDatabaseIPC } from '../../lib/query-commands'
import { showErrorToast } from '../toast-store'
import { logFrontendError } from '../../lib/app-log-commands'
import { toErrorMessage } from '../../lib/error-message'
import {
  applyProfileDefaultDatabase,
  setSessionDatabase,
} from '../connection-store/connection-reducers'
import { useConnectionStore } from '../connection-store'

const KEEP_EXISTING_PASSWORD = ''

export async function setActiveDatabase(sessionId: string, databaseName: string): Promise<void> {
  const active = useConnectionStore.getState().activeConnections[sessionId]
  const trimmedName = databaseName.trim()
  const currentSessionDatabase = active?.sessionDatabase ?? active?.profile.defaultDatabase ?? null

  if (!active) return
  if (!trimmedName) return
  if (currentSessionDatabase === trimmedName) return

  const originalSessionDatabase = currentSessionDatabase

  useConnectionStore.setState((state) =>
    setSessionDatabase(state, { sessionId: sessionId, sessionDatabase: trimmedName })
  )

  try {
    await selectDatabaseIPC(sessionId, trimmedName)
  } catch (error) {
    const message = toErrorMessage(error)
    showErrorToast('Failed to switch database', message)

    if (useConnectionStore.getState().activeConnections[sessionId]) {
      useConnectionStore.setState((state) =>
        setSessionDatabase(state, {
          sessionId: sessionId,
          sessionDatabase: originalSessionDatabase,
        })
      )
    }
  }
}

export async function updateDefaultDatabase(
  sessionId: string,
  newDefaultDb: string | null
): Promise<void> {
  const active = useConnectionStore.getState().activeConnections[sessionId]
  if (!active) {
    return
  }

  const profileId = active.profile.id
  const originalDefault = active.profile.defaultDatabase
  const updatedProfile = { ...active.profile, defaultDatabase: newDefaultDb }

  useConnectionStore.setState((state) => applyProfileDefaultDatabase(state, updatedProfile))

  try {
    await updateConnectionIPC(profileId, {
      name: updatedProfile.name,
      host: updatedProfile.host,
      port: updatedProfile.port,
      username: updatedProfile.username,
      password: KEEP_EXISTING_PASSWORD,
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
    const current = useConnectionStore.getState().activeConnections[sessionId]
    if (current) {
      useConnectionStore.setState((state) => applyProfileDefaultDatabase(state, revertedProfile))
    }
  }
}
