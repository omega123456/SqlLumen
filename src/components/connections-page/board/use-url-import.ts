import { useState } from 'react'
import { useConnectionStore } from '../../../stores/connection-store'
import { useConnectionsPageStore } from '../../../stores/connections-page-store'
import { showErrorToast } from '../../../stores/toast-store'
import { saveConnection } from '../../../lib/connection-commands'
import { toErrorMessage } from '../../../lib/error-message'
import { logFrontend } from '../../../lib/app-log-commands'
import type { ConnectionUrlFields } from '../../../lib/mysql-connection-url'
import type { ConnectionFormData, ConnectionFormSeed } from '../../../types/connection'
import { getDefaultFormData } from '../profile/connection-editor-state'

export function formDataFromUrl(fields: ConnectionUrlFields): ConnectionFormData {
  return {
    ...getDefaultFormData(),
    name: fields.host,
    host: fields.host,
    port: fields.port,
    username: fields.username,
    password: fields.password,
    defaultDatabase: fields.database,
  }
}

export function urlSeed(fields: ConnectionUrlFields): ConnectionFormSeed {
  return { data: formDataFromUrl(fields), sourceHadPassword: false }
}

async function saveFromUrl(fields: ConnectionUrlFields): Promise<string | null> {
  try {
    return await saveConnection(formDataFromUrl(fields))
  } catch (error) {
    showErrorToast('Failed to save connection', toErrorMessage(error))
    return null
  }
}

async function openSaved(connectionId: string): Promise<void> {
  const store = useConnectionStore.getState()
  await store.fetchSavedConnections()
  try {
    await store.openConnection(connectionId)
    useConnectionsPageStore.getState().closePage()
  } catch (error) {
    logFrontend(
      'info',
      `[connections-page] Imported connection did not open: ${toErrorMessage(error)}`
    )
  }
}

export function useUrlImport(onImported: () => void) {
  const [isSaving, setIsSaving] = useState(false)

  const saveAndConnect = async (fields: ConnectionUrlFields) => {
    setIsSaving(true)
    const connectionId = await saveFromUrl(fields)
    setIsSaving(false)
    if (connectionId === null) return
    onImported()
    await openSaved(connectionId)
  }

  const reviewAll = (fields: ConnectionUrlFields) => {
    useConnectionsPageStore.getState().showProfile({ kind: 'new', seed: urlSeed(fields) })
  }

  return { isSaving: isSaving, saveAndConnect: saveAndConnect, reviewAll: reviewAll }
}
