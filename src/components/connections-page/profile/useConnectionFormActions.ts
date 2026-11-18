import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { useConnectionStore, type OpenConnectionOptions } from '../../../stores/connection-store'
import { useConnectionsPageStore } from '../../../stores/connections-page-store'
import { showErrorToast, showSuccessToast } from '../../../stores/toast-store'
import { logFrontend } from '../../../lib/app-log-commands'
import {
  testConnection,
  saveConnection as saveConnectionIPC,
  updateConnection,
} from '../../../lib/connection-commands'
import type {
  ConnectionFormData,
  ConnectionFormSeed,
  SavedConnection,
  TestConnectionResult,
} from '../../../types/connection'
import {
  buildErrorResult,
  clearsSavedPassword,
  editorStateFor,
  editorWithField,
  formDataToStore,
  hasFormErrors,
  hasSavedPasswordAfterUpdate,
  oneOffPassword,
  resolveCurrentConnectionId,
  shouldUseSavedPassword,
  validationPatch,
  type ConnectionEditorState,
  type PendingAction,
  type SslPathField,
} from './connection-editor-state'
import type { ProfileSection } from './profile-sections'

const CERTIFICATE_FILE_FILTERS = [{ name: 'Certificates', extensions: ['pem', 'crt', 'key'] }]
const SAVE_FAILED_TITLE = 'Failed to save connection'

export interface ConnectionFormActionsInputs {
  editingConnection: SavedConnection | undefined
  initialData: ConnectionFormSeed | undefined
  onInvalidSections: (sections: ProfileSection[]) => void
}

interface FormActionContext {
  inputs: ConnectionFormActionsInputs
  editor: ConnectionEditorState
  setEditor: Dispatch<SetStateAction<ConnectionEditorState>>
  setPendingAction: (action: PendingAction | null) => void
  currentConnectionId: string | null
}

function patchEditorOf(context: FormActionContext) {
  return (patch: Partial<ConnectionEditorState>) =>
    context.setEditor((current) => ({ ...current, ...patch }))
}

function fieldActions(context: FormActionContext) {
  const patchEditor = patchEditorOf(context)

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
      logFrontend('warn', `[connection-profile] Certificate file dialog failed: ${String(error)}`)
    }
  }

  return {
    updateField: updateField,
    browseSslFile: browseSslFile,
    changeSavePassword: (savePassword: boolean) => patchEditor({ savePassword: savePassword }),
    replaceFormData: (formData: ConnectionFormData) =>
      patchEditor({ formData: formData, errors: {} }),
  }
}

function validationActions(context: FormActionContext) {
  const patchEditor = patchEditorOf(context)

  const runValidation = (): boolean => {
    const validation = validationPatch(context.editor.formData)
    patchEditor({ errors: validation.errors })
    if (hasFormErrors(validation.errors)) {
      context.inputs.onInvalidSections(validation.sectionsToOpen)
      return false
    }
    return true
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
  const storedFormData = formDataToStore(editor)

  const updateExistingConnection = async (existingId: string): Promise<string> => {
    await updateConnection(existingId, storedFormData, {
      clearPassword: clearsSavedPassword(editor),
    })
    patchEditor({ hasSavedPassword: hasSavedPasswordAfterUpdate(editor) })
    await fetchSavedConnections()
    return existingId
  }

  const createConnection = async (): Promise<string> => {
    const newId = await saveConnectionIPC(storedFormData)
    patchEditor({ savedId: newId, hasSavedPassword: storedFormData.password !== '' })
    await fetchSavedConnections()
    return newId
  }

  return async (): Promise<string> => {
    const existingId = context.currentConnectionId
    if (existingId) return updateExistingConnection(existingId)
    return createConnection()
  }
}

interface FormStoreActions {
  fetchSavedConnections: () => Promise<void>
  openConnection: (connectionId: string, options?: OpenConnectionOptions) => Promise<void>
  closePage: () => void
}

function saveActions(context: FormActionContext, store: FormStoreActions) {
  const patchEditor = patchEditorOf(context)
  const { runValidation, reportFailure } = validationActions(context)
  const persistConnection = persistAction(context, store.fetchSavedConnections)
  const { setPendingAction } = context

  const persistReportingFailure = async (): Promise<string | null> => {
    try {
      return await persistConnection()
    } catch (error) {
      reportFailure(error, SAVE_FAILED_TITLE)
      return null
    }
  }

  const save = async (): Promise<string | null> => {
    if (!runValidation()) return null

    setPendingAction('save')
    const persistedId = await persistReportingFailure()
    setPendingAction(null)
    if (persistedId !== null) {
      showSuccessToast('Connection saved', context.editor.formData.name.trim() || undefined)
    }
    return persistedId
  }

  const openPersistedConnection = async (connectionId: string) => {
    try {
      await store.openConnection(connectionId, {
        password: oneOffPassword(context.editor),
        toastOnFailure: false,
      })
      store.closePage()
    } catch (error) {
      patchEditor({ testResult: buildErrorResult(error) })
    }
  }

  const connect = async () => {
    if (!runValidation()) return

    setPendingAction('connect')
    const connectionId = await persistReportingFailure()
    if (connectionId !== null) {
      await openPersistedConnection(connectionId)
    }
    setPendingAction(null)
  }

  return { save: save, connect: connect }
}

function useFormStoreActions(): FormStoreActions {
  const fetchSavedConnections = useConnectionStore((state) => state.fetchSavedConnections)
  const openConnection = useConnectionStore((state) => state.openConnection)
  const closePage = useConnectionsPageStore((state) => state.closePage)
  return {
    fetchSavedConnections: fetchSavedConnections,
    openConnection: openConnection,
    closePage: closePage,
  }
}

export function useConnectionFormActions(inputs: ConnectionFormActionsInputs) {
  const { editingConnection, initialData } = inputs
  const [editor, setEditor] = useState<ConnectionEditorState>(() =>
    editorStateFor(editingConnection, initialData)
  )
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const store = useFormStoreActions()

  useEffect(() => {
    setEditor(editorStateFor(editingConnection, initialData))
  }, [editingConnection, initialData])

  const context: FormActionContext = {
    inputs: inputs,
    editor: editor,
    setEditor: setEditor,
    setPendingAction: setPendingAction,
    currentConnectionId: resolveCurrentConnectionId(editor, editingConnection),
  }

  return {
    editor: editor,
    pendingAction: pendingAction,
    currentConnectionId: context.currentConnectionId,
    ...fieldActions(context),
    runTestConnection: testAction(context),
    ...saveActions(context, store),
  }
}

export type ConnectionFormActions = ReturnType<typeof useConnectionFormActions>
