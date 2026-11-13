import { useEffect, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { useConnectionStore } from '../../stores/connection-store'
import { showErrorToast, showSuccessToast } from '../../stores/toast-store'
import { logFrontend } from '../../lib/app-log-commands'
import {
  deleteConnection,
  testConnection,
  saveConnection as saveConnectionIPC,
  updateConnection,
} from '../../lib/connection-commands'
import type {
  ConnectionFormData,
  SavedConnection,
  TestConnectionResult,
} from '../../types/connection'
import {
  buildErrorResult,
  createIdleEditorState,
  deletedEditorState,
  editorStateFor,
  editorWithField,
  hasFormErrors,
  hasSavedPasswordAfterUpdate,
  resolveCurrentConnectionId,
  shouldUseSavedPassword,
  validationPatch,
  type ConnectionEditorState,
  type ConnectionFormSeed,
  type FormTab,
  type PendingAction,
  type SslPathField,
} from './connection-editor-state'

const CERTIFICATE_FILE_FILTERS = [{ name: 'Certificates', extensions: ['pem', 'crt', 'key'] }]
const DELETE_FAILED_MESSAGE = 'Failed to delete connection'
const SAVE_FAILED_TITLE = 'Failed to save connection'

export interface ConnectionFormActionsInputs {
  editingConnection: SavedConnection | undefined
  initialData: ConnectionFormSeed | undefined
  onDeleteConnection: ((id: string) => void) | undefined
}

export function useConnectionFormActions({
  editingConnection,
  initialData,
  onDeleteConnection,
}: ConnectionFormActionsInputs) {
  const [editor, setEditor] = useState<ConnectionEditorState>(createIdleEditorState)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const fetchSavedConnections = useConnectionStore((state) => state.fetchSavedConnections)
  const openConnection = useConnectionStore((state) => state.openConnection)
  const closeDialog = useConnectionStore((state) => state.closeDialog)
  const { formData, savedId, clearSavedPassword, deletedConnectionId } = editor

  useEffect(() => {
    setEditor(editorStateFor(editingConnection, initialData))
  }, [editingConnection, initialData])

  const patchEditor = (patch: Partial<ConnectionEditorState>) =>
    setEditor((current) => ({ ...current, ...patch }))

  const updateField = <K extends keyof ConnectionFormData>(
    field: K,
    value: ConnectionFormData[K]
  ) => {
    setEditor((current) => editorWithField(current, { field: field, value: value }))
  }

  const currentConnectionId = resolveCurrentConnectionId({
    savedId: savedId,
    editingConnection: editingConnection,
    deletedConnectionId: deletedConnectionId,
  })

  const browseSslFile = async (field: SslPathField) => {
    try {
      const selected = await open({ multiple: false, filters: CERTIFICATE_FILE_FILTERS })
      if (typeof selected === 'string') {
        updateField(field, selected)
      }
    } catch (error) {
      logFrontend('warn', `[connection-form] Certificate file dialog failed: ${String(error)}`)
    }
  }

  const changePassword = (value: string) => {
    updateField('password', value)
    if (clearSavedPassword) {
      patchEditor({ clearSavedPassword: false })
    }
  }

  const changeClearSavedPassword = (checked: boolean) => {
    patchEditor({ clearSavedPassword: checked })
    if (checked && formData.password) {
      updateField('password', '')
    }
  }

  const cancelDeleteConfirm = () => {
    if (pendingAction === 'delete') return
    patchEditor({ deleteConfirm: null })
  }

  const runValidation = (): boolean => {
    const validation = validationPatch(formData)
    patchEditor(validation)
    return !hasFormErrors(validation.errors)
  }

  const reportFailure = (error: unknown, toastTitle: string): TestConnectionResult => {
    const failure = buildErrorResult(error)
    patchEditor({ testResult: failure })
    showErrorToast(toastTitle, failure.errorMessage ?? undefined)
    return failure
  }

  const runTestConnection = async () => {
    if (!runValidation()) return

    setPendingAction('test')
    patchEditor({ testResult: null })
    try {
      const savedPasswordOwnerId = shouldUseSavedPassword(editor) ? currentConnectionId : null
      const result = await testConnection(formData, savedPasswordOwnerId)
      patchEditor({ testResult: result })
    } catch (error) {
      reportFailure(error, 'Connection test failed')
    } finally {
      setPendingAction(null)
    }
  }

  const updateExistingConnection = async (existingId: string): Promise<string> => {
    await updateConnection(existingId, formData, { clearPassword: clearSavedPassword })
    patchEditor({ hasSavedPassword: hasSavedPasswordAfterUpdate(editor) })
    await fetchSavedConnections()
    return existingId
  }

  const createConnection = async (): Promise<string> => {
    const newId = await saveConnectionIPC(formData)
    patchEditor({ savedId: newId, hasSavedPassword: formData.password !== '' })
    await fetchSavedConnections()
    return newId
  }

  const saveOrUpdateConnection = (): Promise<string> => {
    const existingId = savedId ?? editingConnection?.id
    if (existingId) return updateExistingConnection(existingId)
    return createConnection()
  }

  const persistConnection = async (): Promise<string> => {
    const persistedId = await saveOrUpdateConnection()
    patchEditor({ clearSavedPassword: false })
    return persistedId
  }

  const save = async () => {
    if (!runValidation()) return

    setPendingAction('save')
    try {
      await persistConnection()
      showSuccessToast('Connection saved', formData.name.trim() || undefined)
    } catch (error) {
      reportFailure(error, SAVE_FAILED_TITLE)
    } finally {
      setPendingAction(null)
    }
  }

  const persistBeforeConnect = async (): Promise<string | null> => {
    try {
      return await persistConnection()
    } catch (error) {
      reportFailure(error, SAVE_FAILED_TITLE)
      return null
    }
  }

  const openPersistedConnection = async (connectionId: string) => {
    try {
      await openConnection(connectionId)
      closeDialog()
    } catch (error) {
      patchEditor({ testResult: buildErrorResult(error) })
    }
  }

  const connect = async () => {
    if (!runValidation()) return

    setPendingAction('connect')
    const connectionId = await persistBeforeConnect()
    if (connectionId !== null) {
      await openPersistedConnection(connectionId)
    }
    setPendingAction(null)
  }

  const deleteCurrentConnection = async () => {
    if (!currentConnectionId) return

    setPendingAction('delete')
    patchEditor({ deleteConfirm: { error: null } })
    try {
      await deleteConnection(currentConnectionId)
      await fetchSavedConnections()
      setEditor((current) => deletedEditorState(current, currentConnectionId))
      onDeleteConnection?.(currentConnectionId)
      showSuccessToast('Connection deleted')
    } catch (error) {
      const failure = reportFailure(error, DELETE_FAILED_MESSAGE)
      patchEditor({ deleteConfirm: { error: failure.errorMessage ?? DELETE_FAILED_MESSAGE } })
    } finally {
      setPendingAction(null)
    }
  }

  return {
    editor: editor,
    pendingAction: pendingAction,
    currentConnectionId: currentConnectionId,
    updateField: updateField,
    selectTab: (tab: FormTab) => patchEditor({ activeTab: tab }),
    browseSslFile: browseSslFile,
    changePassword: changePassword,
    changeClearSavedPassword: changeClearSavedPassword,
    requestDelete: () => patchEditor({ deleteConfirm: { error: null } }),
    cancelDeleteConfirm: cancelDeleteConfirm,
    runTestConnection: runTestConnection,
    save: save,
    connect: connect,
    deleteCurrentConnection: deleteCurrentConnection,
  }
}
