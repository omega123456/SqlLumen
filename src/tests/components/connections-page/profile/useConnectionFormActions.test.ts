import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useConnectionFormActions } from '../../../../components/connections-page/profile/useConnectionFormActions'
import { useConnectionStore } from '../../../../stores/connection-store'
import { ipc } from '../../../ipc-mock'
import { useConnectionsPageStore } from '../../../../stores/connections-page-store'
import type { SavedConnection } from '../../../../types/connection'
import { makeSavedConnection } from '../../../helpers/connection-test-utils'

interface HookInputs {
  editingConnection?: SavedConnection
  onInvalidSections?: (sections: string[]) => void
}

function renderFormActions({ editingConnection, onInvalidSections = vi.fn() }: HookInputs = {}) {
  return renderHook(() =>
    useConnectionFormActions({
      editingConnection: editingConnection,
      initialData: undefined,
      onInvalidSections: onInvalidSections,
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
  it('blocks saving an invalid form and opens the sections with errors', async () => {
    const onInvalidSections = vi.fn()
    const hook = renderFormActions({ onInvalidSections: onInvalidSections })
    await act(() => hook.result.current.save())
    expect(hook.result.current.editor.errors.name).toBe('Connection name is required')
    expect(onInvalidSections).toHaveBeenCalledWith(['server', 'signIn', 'behaviour'])
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

  it('connects once with an unsaved password and closes the page', async () => {
    ipc.override('list_connections', () => [makeSavedConnection({ id: 'conn-mock-new' })])
    act(() => useConnectionsPageStore.getState().openPage())
    const hook = renderFormActions()
    fillRequiredFields(hook)
    act(() => {
      hook.result.current.updateField('password', 'once')
      hook.result.current.changeSavePassword(false)
    })
    await act(() => hook.result.current.connect())
    expect(ipc.calls('save_connection')[0]).toMatchObject({ data: { password: null } })
    expect(ipc.calls('open_connection')[0]).toMatchObject({ payload: { password: 'once' } })
    expect(useConnectionsPageStore.getState().isOpen).toBe(false)
  })

  it('fills an SSL path from the file dialog', async () => {
    ipc.override('plugin:dialog|open', () => '/certs/ca.pem')
    const hook = renderFormActions()
    await act(() => hook.result.current.browseSslFile('sslCaPath'))
    expect(hook.result.current.editor.formData.sslCaPath).toBe('/certs/ca.pem')
  })
})
