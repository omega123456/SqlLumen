import { useState } from 'react'
import { useConnectionStore } from '../../../stores/connection-store'
import { useConnectionsPageStore } from '../../../stores/connections-page-store'
import { showErrorToast, showSuccessToast } from '../../../stores/toast-store'
import {
  deleteConnection,
  isAccessDenied,
  updateConnection,
} from '../../../lib/connection-commands'
import { formDataFromConnection } from '../../../lib/connection-form-data'
import { formatConnectionUrl } from '../../../lib/mysql-connection-url'
import { writeClipboardText } from '../../../lib/context-menu-utils'
import { toErrorMessage } from '../../../lib/error-message'
import type { SavedConnection } from '../../../types/connection'
import { duplicateSeedFor } from '../profile/duplicate-seed'
import { openSessionOf } from './board-model'

export type TileStatus =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'failed'; message: string }
  | { kind: 'needsPassword'; message: string | null }

export interface PasswordSubmission {
  password: string
  savePassword: boolean
}

export interface PendingDelete {
  connection: SavedConnection
  isDeleting: boolean
  error: string | null
}

const IDLE_STATUS: TileStatus = { kind: 'idle' }
const BUSY_STATUS: TileStatus = { kind: 'busy' }
const FIRST_PASSWORD_PROMPT: TileStatus = { kind: 'needsPassword', message: null }

function asksForPassword(connection: SavedConnection, error: unknown): boolean {
  return isAccessDenied(error) && !connection.hasPassword
}

function failureStatus(connection: SavedConnection, error: unknown): TileStatus {
  const message = toErrorMessage(error)
  if (asksForPassword(connection, error)) return { kind: 'needsPassword', message: message }
  return { kind: 'failed', message: message }
}

function promptOnFirstDenial(status: TileStatus, previous: TileStatus): TileStatus {
  const isFirstPrompt = status.kind === 'needsPassword' && previous.kind !== 'needsPassword'
  return isFirstPrompt ? FIRST_PASSWORD_PROMPT : status
}

async function storePassword(connection: SavedConnection, password: string): Promise<void> {
  try {
    await updateConnection(connection.id, { ...formDataFromConnection(connection), password })
    await useConnectionStore.getState().fetchSavedConnections()
  } catch (error) {
    showErrorToast('Failed to save password', toErrorMessage(error))
  }
}

async function copyConnectionUrl(connection: SavedConnection): Promise<void> {
  try {
    await writeClipboardText(formatConnectionUrl(connection))
    showSuccessToast('Connection URL copied', connection.name)
  } catch (error) {
    showErrorToast('Failed to copy URL', toErrorMessage(error))
  }
}

function useTileStatuses() {
  const [statuses, setStatuses] = useState<Record<string, TileStatus>>({})
  const statusOf = (profileId: string): TileStatus => statuses[profileId] ?? IDLE_STATUS
  const setStatus = (profileId: string, status: TileStatus) =>
    setStatuses((current) => ({ ...current, [profileId]: status }))
  return { statusOf: statusOf, setStatus: setStatus }
}

function useDeleteConfirmation() {
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)

  const confirmDelete = async () => {
    if (!pendingDelete) return
    const { connection } = pendingDelete
    setPendingDelete({ connection: connection, isDeleting: true, error: null })
    try {
      await deleteConnection(connection.id)
      await useConnectionStore.getState().fetchSavedConnections()
      setPendingDelete(null)
      showSuccessToast('Connection deleted', connection.name)
    } catch (error) {
      const message = toErrorMessage(error)
      setPendingDelete({ connection: connection, isDeleting: false, error: message })
      showErrorToast('Failed to delete connection', message)
    }
  }

  return {
    pendingDelete: pendingDelete,
    requestDelete: (connection: SavedConnection) =>
      setPendingDelete({ connection: connection, isDeleting: false, error: null }),
    cancelDelete: () => setPendingDelete(null),
    confirmDelete: confirmDelete,
  }
}

export function useTileActions() {
  const { statusOf, setStatus } = useTileStatuses()
  const [announcement, setAnnouncement] = useState('')
  const deletion = useDeleteConfirmation()
  const showProfile = useConnectionsPageStore((state) => state.showProfile)

  const openWithStatus = async (connection: SavedConnection, password?: string) => {
    const previous = statusOf(connection.id)
    setStatus(connection.id, BUSY_STATUS)
    setAnnouncement(`Connecting to ${connection.name}`)
    try {
      await useConnectionStore.getState().openConnection(connection.id, {
        password: password,
        toastOnFailure: false,
      })
      setStatus(connection.id, IDLE_STATUS)
      return true
    } catch (error) {
      setStatus(connection.id, promptOnFirstDenial(failureStatus(connection, error), previous))
      setAnnouncement(`Could not connect to ${connection.name}`)
      return false
    }
  }

  const openNewSession = async (connection: SavedConnection) => {
    if (statusOf(connection.id).kind === 'busy') return
    const connected = await openWithStatus(connection)
    if (connected) useConnectionsPageStore.getState().closePage()
  }

  const activate = async (connection: SavedConnection) => {
    const store = useConnectionStore.getState()
    const sessionId = openSessionOf(store.activeConnections, connection.id)
    if (sessionId) {
      store.switchTab(sessionId)
      useConnectionsPageStore.getState().closePage()
      return
    }
    await openNewSession(connection)
  }

  const submitPassword = async (connection: SavedConnection, submission: PasswordSubmission) => {
    const connected = await openWithStatus(connection, submission.password)
    if (!connected) return
    if (submission.savePassword) await storePassword(connection, submission.password)
    useConnectionsPageStore.getState().closePage()
  }

  return {
    statusOf: statusOf,
    announcement: announcement,
    activate: activate,
    openNewSession: openNewSession,
    submitPassword: submitPassword,
    edit: (profileId: string) => showProfile({ kind: 'existing', profileId: profileId }),
    duplicate: (connection: SavedConnection) =>
      showProfile({ kind: 'new', seed: duplicateSeedFor(connection) }),
    copyUrl: copyConnectionUrl,
    ...deletion,
  }
}

export type TileActions = ReturnType<typeof useTileActions>
