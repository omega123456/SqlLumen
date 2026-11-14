import { useCallback, useState } from 'react'
import type { SavedConnection } from '../../../types/connection'
import type { ConnectionFormSeed } from '../connection-editor-state'

export interface EditorTarget {
  editingConnection: SavedConnection | null
  duplicateSeed: ConnectionFormSeed | null
}

const NEW_CONNECTION_TARGET: EditorTarget = { editingConnection: null, duplicateSeed: null }

export function duplicateSeedFor(
  source: SavedConnection,
  previousSeed: ConnectionFormSeed | null
): ConnectionFormSeed {
  return {
    data: {
      name: `Copy of ${source.name.trim() || source.host}`,
      host: source.host,
      port: source.port,
      username: source.username,
      password: '',
      defaultDatabase: source.defaultDatabase,
      sslEnabled: source.sslEnabled,
      sslCaPath: source.sslCaPath,
      sslCertPath: source.sslCertPath,
      sslKeyPath: source.sslKeyPath,
      color: source.color,
      groupId: source.groupId,
      readOnly: source.readOnly,
      connectTimeoutSecs: source.connectTimeoutSecs,
      keepaliveIntervalSecs: source.keepaliveIntervalSecs,
    },
    sourceHadPassword: source.hasPassword,
    key: (previousSeed?.key ?? 0) + 1,
  }
}

export function useEditorTarget() {
  const [target, setTarget] = useState<EditorTarget>(NEW_CONNECTION_TARGET)

  const reset = useCallback(() => setTarget(NEW_CONNECTION_TARGET), [])

  const select = useCallback((connection: SavedConnection) => {
    setTarget({ editingConnection: connection, duplicateSeed: null })
  }, [])

  const duplicate = useCallback((source: SavedConnection) => {
    setTarget((previous) => ({
      editingConnection: null,
      duplicateSeed: duplicateSeedFor(source, previous.duplicateSeed),
    }))
  }, [])

  const forgetDeleted = useCallback((id: string) => {
    setTarget((previous) => {
      const isEditingDeletedConnection = previous.editingConnection?.id === id
      if (!isEditingDeletedConnection) return previous
      return { editingConnection: null, duplicateSeed: previous.duplicateSeed }
    })
  }, [])

  return {
    target: target,
    reset: reset,
    select: select,
    duplicate: duplicate,
    forgetDeleted: forgetDeleted,
  }
}
