import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
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

interface FormActionContext {
  inputs: ConnectionFormActionsInputs
  editor: ConnectionEditorState
  setEditor: Dispatch<SetStateAction<ConnectionEditorState>>
  pendingAction: PendingAction | null
  setPendingAction: (action: PendingAction | null) => void
  currentConnectionId: string | null
}

function patchEditorOf(context: FormActionContext) {
  return (patch: Partial<ConnectionEditorState>) =>
    context.setEditor((current) => ({ ...current, ...patch }))
}

function fieldActions(context: FormActionContext) {
  const patchEditor = patchEditorOf(context)
  const { formData, clearSavedPassword } = context.editor

  const updateField = <K extends keyof ConnectionFormData>(
    field: K,
    value: ConnectionFormData[K]
  ) => {
    context.setEditor((current) => editorWithField(current, { field: field, value: value }))
  }

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

  return {
    updateField: updateField,
    selectTab: (tab: FormTab) => patchEditor({ activeTab: tab }),
    browseSslFile: browseSslFile,
    changePassword: changePassword,
    changeClearSavedPassword: changeClearSavedPassword,
  }
}

function validationActions(context: FormActionContext) {
  const patchEditor = patchEditorOf(context)

  const runValidation = (): boolean => {
    const validation = validationPatch(context.editor.formData)
    patchEditor(validation)
    return !hasFormErrors(validation.errors)
  }

  const reportFailure = (error: unknown, toastTitle: string): TestConnectionResult => {
    const failure = buildErrorResult(error)
    patchEditor({ testResult: failure })
    showErrorToast(toastTitle, failure.errorMessage ?? undefined)
    return failure
  }

  return { runValidation: runValidation, reportFailure: reportFailure }
}

function testAction(context: FormActionContext) {
  const patchEditor = patchEditorOf(context)
  const { runValidation, reportFailure } = validationActions(context)
  const { editor, currentConnectionId, setPendingAction } = context

  return async () => {
    if (!runValidation()) return

    setPendingAction('test')
    patchEditor({ testResult: null })
    try {
      const savedPasswordOwnerId = shouldUseSavedPassword(editor) ? currentConnectionId : null
      const result = await testConnection(editor.formData, savedPasswordOwnerId)
      patchEditor({ testResult: result })
    } catch (error) {
      reportFailure(error, 'Connection test failed')
    } finally {
      setPendingAction(null)
    }
  }
}

function persistAction(context: FormActionContext, fetchSavedConnections: () => Promise<void>) {
  const patchEditor = patchEditorOf(context)
  const { editor } = context
  const { formData, savedId, clearSavedPassword } = editor

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

  return async (): Promise<string> => {
    const existingId = savedId ?? context.inputs.editingConnection?.id
    const persistedId = existingId
      ? await updateExistingConnection(existingId)
      : await createConnection()
    patchEditor({ clearSavedPassword: false })
    return persistedId
  }
}

interface ConnectionStoreActions {
  fetchSavedConnections: () => Promise<void>
  openConnection: (connectionId: string) => Promise<void>
  closeDialog: () => void
}

function saveActions(context: FormActionContext, store: ConnectionStoreActions) {
  const patchEditor = patchEditorOf(context)
  const { runValidation, reportFailure } = validationActions(context)
  const persistConnection = persistAction(context, store.fetchSavedConnections)
  const { setPendingAction } = context

  const save = async () => {
    if (!runValidation()) return

    setPendingAction('save')
    try {
      await persistConnection()
      showSuccessToast('Connection saved', context.editor.formData.name.trim() || undefined)
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
      await store.openConnection(connectionId)
      store.closeDialog()
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

  return { save: save, connect: connect }
}

function deleteActions(context: FormActionContext, fetchSavedConnections: () => Promise<void>) {
  const patchEditor = patchEditorOf(context)
  const { reportFailure } = validationActions(context)
  const { currentConnectionId, pendingAction, setPendingAction } = context

  const deleteCurrentConnection = async () => {
    if (!currentConnectionId) return

    setPendingAction('delete')
    patchEditor({ deleteConfirm: { error: null } })
    try {
      await deleteConnection(currentConnectionId)
      await fetchSavedConnections()
      context.setEditor((current) => deletedEditorState(current, currentConnectionId))
      context.inputs.onDeleteConnection?.(currentConnectionId)
      showSuccessToast('Connection deleted')
    } catch (error) {
      const failure = reportFailure(error, DELETE_FAILED_MESSAGE)
      patchEditor({ deleteConfirm: { error: failure.errorMessage ?? DELETE_FAILED_MESSAGE } })
    } finally {
      setPendingAction(null)
    }
  }

  const cancelDeleteConfirm = () => {
    if (pendingAction === 'delete') return
    patchEditor({ deleteConfirm: null })
  }

  return {
    requestDelete: () => patchEditor({ deleteConfirm: { error: null } }),
    cancelDeleteConfirm: cancelDeleteConfirm,
    deleteCurrentConnection: deleteCurrentConnection,
  }
}

function useConnectionStoreActions(): ConnectionStoreActions {
  const fetchSavedConnections = useConnectionStore((state) => state.fetchSavedConnections)
  const openConnection = useConnectionStore((state) => state.openConnection)
  const closeDialog = useConnectionStore((state) => state.closeDialog)
  return {
    fetchSavedConnections: fetchSavedConnections,
    openConnection: openConnection,
    closeDialog: closeDialog,
  }
}

export function useConnectionFormActions(inputs: ConnectionFormActionsInputs) {
  const { editingConnection, initialData } = inputs
  const [editor, setEditor] = useState<ConnectionEditorState>(createIdleEditorState)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const store = useConnectionStoreActions()

  useEffect(() => {
    setEditor(editorStateFor(editingConnection, initialData))
  }, [editingConnection, initialData])

  const context: FormActionContext = {
    inputs: inputs,
    editor: editor,
    setEditor: setEditor,
    pendingAction: pendingAction,
    setPendingAction: setPendingAction,
    currentConnectionId: resolveCurrentConnectionId({
      savedId: editor.savedId,
      editingConnection: editingConnection,
      deletedConnectionId: editor.deletedConnectionId,
    }),
  }

  return {
    editor: editor,
    pendingAction: pendingAction,
    currentConnectionId: context.currentConnectionId,
    ...fieldActions(context),
    ...deleteActions(context, store.fetchSavedConnections),
    runTestConnection: testAction(context),
    ...saveActions(context, store),
  }
}
