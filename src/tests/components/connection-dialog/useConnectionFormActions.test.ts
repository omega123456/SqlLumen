import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useConnectionFormActions } from '../../../components/connection-dialog/useConnectionFormActions'
import { useConnectionStore } from '../../../stores/connection-store'
import { ipc } from '../../ipc-mock'
import type { SavedConnection } from '../../../types/connection'

function makeSavedConnection(): SavedConnection {
  return {
    id: 'conn-1',
    name: 'Test DB',
    host: '127.0.0.1',
    port: 3306,
    username: 'root',
    hasPassword: true,
    defaultDatabase: null,
    sslEnabled: false,
    sslCaPath: null,
    sslCertPath: null,
    sslKeyPath: null,
    color: null,
    groupId: null,
    readOnly: false,
    sortOrder: 0,
    connectTimeoutSecs: 10,
    keepaliveIntervalSecs: 30,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  }
}

interface HookInputs {
  editingConnection?: SavedConnection
  onDeleteConnection?: (id: string) => void
}

function renderFormActions({ editingConnection, onDeleteConnection }: HookInputs = {}) {
  return renderHook(() =>
    useConnectionFormActions({
      editingConnection: editingConnection,
      initialData: undefined,
      onDeleteConnection: onDeleteConnection,
    })
  )
}

function fillRequiredFields(hook: ReturnType<typeof renderFormActions>) {
  act(() => {
    hook.result.current.updateField('name', 'Local')
    hook.result.current.updateField('host', 'localhost')
    hook.result.current.updateField('username', 'root')
  })
}

beforeEach(() => {
  act(() => {
    useConnectionStore.setState({ savedConnections: [], connectionGroups: [] })
  })
})

describe('useConnectionFormActions', () => {
  it('blocks saving an invalid form and reports the errors', async () => {
    const hook = renderFormActions()
    await act(() => hook.result.current.save())
    expect(hook.result.current.editor.errors.name).toBe('Connection name is required')
    expect(ipc.calls('save_connection')).toHaveLength(0)
  })

  it('saves a new connection and remembers its id', async () => {
    const hook = renderFormActions()
    fillRequiredFields(hook)
    await act(() => hook.result.current.save())
    expect(hook.result.current.editor.savedId).toBe('conn-mock-new')
    expect(hook.result.current.currentConnectionId).toBe('conn-mock-new')
    expect(hook.result.current.pendingAction).toBeNull()
  })

  it('updates an existing connection', async () => {
    const hook = renderFormActions({ editingConnection: makeSavedConnection() })
    await waitFor(() => expect(hook.result.current.editor.formData.host).toBe('127.0.0.1'))
    await act(() => hook.result.current.save())
    expect(ipc.calls('update_connection')).toHaveLength(1)
    expect(hook.result.current.editor.hasSavedPassword).toBe(true)
  })

  it('stores a failed test result when the connection test throws', async () => {
    ipc.override('test_connection', () => {
      throw new Error('refused')
    })
    const hook = renderFormActions()
    fillRequiredFields(hook)
    await act(() => hook.result.current.runTestConnection())
    expect(hook.result.current.editor.testResult?.errorMessage).toBe('refused')
  })

  it('keeps the dialog open with an error result when connecting fails', async () => {
    ipc.override('open_connection', () => {
      throw new Error('auth failed')
    })
    const hook = renderFormActions()
    fillRequiredFields(hook)
    await act(() => hook.result.current.connect())
    expect(hook.result.current.editor.testResult?.success).toBe(false)
    expect(hook.result.current.pendingAction).toBeNull()
  })

  it('does not connect when saving fails', async () => {
    ipc.override('save_connection', () => {
      throw new Error('disk full')
    })
    const hook = renderFormActions()
    fillRequiredFields(hook)
    await act(() => hook.result.current.connect())
    expect(ipc.calls('open_connection')).toHaveLength(0)
    expect(hook.result.current.editor.testResult?.errorMessage).toBe('disk full')
  })

  it('deletes the current connection and resets the editor', async () => {
    const onDeleteConnection = vi.fn()
    const hook = renderFormActions({
      editingConnection: makeSavedConnection(),
      onDeleteConnection: onDeleteConnection,
    })
    await waitFor(() => expect(hook.result.current.currentConnectionId).toBe('conn-1'))
    act(() => hook.result.current.requestDelete())
    expect(hook.result.current.editor.deleteConfirm).toEqual({ error: null })
    await act(() => hook.result.current.deleteCurrentConnection())
    expect(onDeleteConnection).toHaveBeenCalledWith('conn-1')
    expect(hook.result.current.currentConnectionId).toBeNull()
    expect(hook.result.current.editor.deleteConfirm).toBeNull()
  })

  it('shows the delete failure inside the confirmation', async () => {
    ipc.override('delete_connection', () => {
      throw new Error('locked')
    })
    const hook = renderFormActions({ editingConnection: makeSavedConnection() })
    await waitFor(() => expect(hook.result.current.currentConnectionId).toBe('conn-1'))
    await act(() => hook.result.current.deleteCurrentConnection())
    expect(hook.result.current.editor.deleteConfirm).toEqual({ error: 'locked' })
  })

  it('clears the typed password when removing the saved password', () => {
    const hook = renderFormActions()
    act(() => hook.result.current.changePassword('secret'))
    act(() => hook.result.current.changeClearSavedPassword(true))
    expect(hook.result.current.editor.formData.password).toBe('')
    expect(hook.result.current.editor.clearSavedPassword).toBe(true)
    act(() => hook.result.current.changePassword('again'))
    expect(hook.result.current.editor.clearSavedPassword).toBe(false)
  })

  it('fills an SSL path from the file dialog', async () => {
    ipc.override('plugin:dialog|open', () => '/certs/ca.pem')
    const hook = renderFormActions()
    await act(() => hook.result.current.browseSslFile('sslCaPath'))
    expect(hook.result.current.editor.formData.sslCaPath).toBe('/certs/ca.pem')
  })

  it('switches tabs and cancels a delete confirmation', () => {
    const hook = renderFormActions()
    act(() => hook.result.current.selectTab('ssl'))
    act(() => hook.result.current.requestDelete())
    act(() => hook.result.current.cancelDeleteConfirm())
    expect(hook.result.current.editor.activeTab).toBe('ssl')
    expect(hook.result.current.editor.deleteConfirm).toBeNull()
  })
})
