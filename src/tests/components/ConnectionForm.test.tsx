import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConnectionForm } from '../../components/connection-dialog/ConnectionForm'
import { useConnectionStore } from '../../stores/connection-store'
import { useSettingsStore } from '../../stores/settings-store'
import { ipc } from '../ipc-mock'
import type { SavedConnection } from '../../types/connection'

function makeSavedConnection(overrides: Partial<SavedConnection> = {}): SavedConnection {
  return {
    id: 'conn-1',
    name: 'Test DB',
    host: '127.0.0.1',
    port: 3306,
    username: 'root',
    hasPassword: true,
    defaultDatabase: 'mydb',
    sslEnabled: false,
    sslCaPath: null,
    sslCertPath: null,
    sslKeyPath: null,
    color: '#3b82f6',
    groupId: null,
    readOnly: false,
    sortOrder: 0,
    connectTimeoutSecs: 10,
    keepaliveIntervalSecs: 30,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  useConnectionStore.setState({
    savedConnections: [],
    connectionGroups: [],
    activeConnections: {},
    activeTabId: null,
    dialogOpen: false,
    error: null,
  })
})

async function switchToTab(
  user: ReturnType<typeof userEvent.setup>,
  tab: 'general' | 'ssl' | 'advanced'
) {
  await user.click(screen.getByTestId(`connection-form-tab-${tab}`))
}

describe('ConnectionForm', () => {
  it('renders all basic form fields', () => {
    render(<ConnectionForm />)

    expect(screen.getByLabelText('Connection name')).toBeInTheDocument()
    expect(screen.getByLabelText('Host address')).toBeInTheDocument()
    expect(screen.getByLabelText('Port')).toBeInTheDocument()
    expect(screen.getByLabelText('Username')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByLabelText('Default Database')).toBeInTheDocument()
  })

  it('renders General, SSL and Advanced tabs with General active', () => {
    render(<ConnectionForm />)

    expect(screen.getByTestId('connection-form-tab-general')).toHaveAttribute('data-active', 'true')
    expect(screen.getByTestId('connection-form-tab-ssl')).not.toHaveAttribute('data-active')
    expect(screen.getByTestId('connection-form-tab-advanced')).not.toHaveAttribute('data-active')
    expect(screen.getByTestId('connection-form-panel-general')).toBeInTheDocument()
  })

  it('tabs switch the visible panel', async () => {
    const user = userEvent.setup()
    render(<ConnectionForm />)

    await switchToTab(user, 'ssl')
    expect(screen.getByTestId('connection-form-panel-ssl')).toBeInTheDocument()
    expect(screen.queryByTestId('connection-form-panel-general')).not.toBeInTheDocument()

    await switchToTab(user, 'advanced')
    expect(screen.getByTestId('connection-form-panel-advanced')).toBeInTheDocument()
    expect(screen.queryByTestId('connection-form-panel-ssl')).not.toBeInTheDocument()

    await switchToTab(user, 'general')
    expect(screen.getByTestId('connection-form-panel-general')).toBeInTheDocument()
  })

  it('tab panel keeps form state across switches', async () => {
    const user = userEvent.setup()
    render(<ConnectionForm />)

    await user.type(screen.getByLabelText('Connection name'), 'Stateful')
    await switchToTab(user, 'ssl')
    await switchToTab(user, 'general')
    expect(screen.getByLabelText('Connection name')).toHaveValue('Stateful')
  })

  it('Test Connection button calls testConnection IPC', async () => {
    const user = userEvent.setup()
    ipc.override('test_connection', () => ({
      success: true,
      serverVersion: '8.0.35',
      authMethod: 'mysql_native_password',
      sslStatus: 'Not using SSL',
      connectionTimeMs: 42,
      errorMessage: null,
    }))

    render(<ConnectionForm />)

    await user.type(screen.getByLabelText('Connection name'), 'Local')
    await user.type(screen.getByLabelText('Host address'), 'localhost')
    await user.type(screen.getByLabelText('Username'), 'root')
    await user.click(screen.getByText('Test Connection'))

    await waitFor(() => {
      expect(ipc.calls('test_connection')).toHaveLength(1)
    })
  })

  it('Save button calls saveConnection IPC', async () => {
    const user = userEvent.setup()
    ipc.override('save_connection', () => 'new-uuid-123')

    render(<ConnectionForm />)

    await user.type(screen.getByLabelText('Connection name'), 'Local')
    await user.type(screen.getByLabelText('Host address'), 'localhost')
    await user.type(screen.getByLabelText('Username'), 'root')
    await user.click(screen.getByText('Save'))

    await waitFor(() => {
      expect(ipc.calls('save_connection')).toHaveLength(1)
    })
  })

  it('form validation shows errors for missing Host', async () => {
    const user = userEvent.setup()
    render(<ConnectionForm />)

    await user.type(screen.getByLabelText('Connection name'), 'Local')
    await user.type(screen.getByLabelText('Username'), 'root')
    await user.click(screen.getByText('Test Connection'))

    expect(screen.getByText('Host is required')).toBeInTheDocument()
  })

  it('form validation shows errors for missing Username', async () => {
    const user = userEvent.setup()
    render(<ConnectionForm />)

    await user.type(screen.getByLabelText('Connection name'), 'Local')
    await user.type(screen.getByLabelText('Host address'), 'localhost')
    await user.click(screen.getByText('Test Connection'))

    expect(screen.getByText('Username is required')).toBeInTheDocument()
  })

  it('validation errors clear when field is filled', async () => {
    const user = userEvent.setup()
    render(<ConnectionForm />)

    await user.click(screen.getByText('Test Connection'))
    expect(screen.getByText('Connection name is required')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Connection name'), 'Local')
    expect(screen.queryByText('Connection name is required')).not.toBeInTheDocument()
    expect(screen.getByText('Host is required')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Host address'), 'localhost')
    expect(screen.queryByText('Host is required')).not.toBeInTheDocument()
  })

  it('Save validation prevents save with empty fields', async () => {
    const user = userEvent.setup()
    render(<ConnectionForm />)

    await user.click(screen.getByText('Save'))

    expect(screen.getByText('Connection name is required')).toBeInTheDocument()
    expect(screen.getByText('Host is required')).toBeInTheDocument()
    expect(screen.getByText('Username is required')).toBeInTheDocument()
    expect(ipc.calls('save_connection')).toHaveLength(0)
  })

  it('Save and Connect validation prevents connect with empty fields', async () => {
    const user = userEvent.setup()
    render(<ConnectionForm />)

    await user.click(screen.getByText('Save and Connect'))

    expect(screen.getByText('Connection name is required')).toBeInTheDocument()
    expect(screen.getByText('Host is required')).toBeInTheDocument()
    expect(screen.getByText('Username is required')).toBeInTheDocument()
    expect(ipc.calls('save_connection')).toHaveLength(0)
  })

  it('password field toggles show/hide', async () => {
    const user = userEvent.setup()
    render(<ConnectionForm />)

    const passwordInput = screen.getByLabelText('Password')
    expect(passwordInput).toHaveAttribute('type', 'password')

    const showBtn = screen.getByLabelText('Show password')
    await user.click(showBtn)
    expect(passwordInput).toHaveAttribute('type', 'text')

    const hideBtn = screen.getByLabelText('Hide password')
    await user.click(hideBtn)
    expect(passwordInput).toHaveAttribute('type', 'password')
  })

  it('renders action buttons', () => {
    render(<ConnectionForm />)

    expect(screen.getByText('Test Connection')).toBeInTheDocument()
    expect(screen.getByText('Save')).toBeInTheDocument()
    expect(screen.getByText('Save and Connect')).toBeInTheDocument()
    expect(screen.queryByText('Delete')).not.toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'Test Connection' })).toHaveClass(
      'ui-button-secondary'
    )
    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass('ui-button-secondary')
    expect(screen.getByRole('button', { name: 'Save and Connect' })).toHaveClass(
      'ui-button-primary'
    )
  })

  it('renders group selector with Ungrouped option', async () => {
    const user = userEvent.setup()
    render(<ConnectionForm />)
    await switchToTab(user, 'advanced')

    const combobox = screen.getByRole('combobox', { name: 'Group' })
    expect(combobox).toBeInTheDocument()
    expect(combobox).toHaveTextContent('Ungrouped')
  })

  it('group selector shows connection groups from store', async () => {
    const user = userEvent.setup()
    useConnectionStore.setState({
      connectionGroups: [
        {
          id: 'grp-1',
          name: 'Production',
          parentId: null,
          sortOrder: 0,
          createdAt: '2025-01-01T00:00:00Z',
        },
      ],
    })

    render(<ConnectionForm />)
    await switchToTab(user, 'advanced')

    await user.click(screen.getByRole('combobox', { name: 'Group' }))
    expect(screen.getByRole('option', { name: 'Production' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Ungrouped' })).toBeInTheDocument()
  })

  it('group selector changes value', async () => {
    const user = userEvent.setup()
    useConnectionStore.setState({
      connectionGroups: [
        {
          id: 'grp-1',
          name: 'Production',
          parentId: null,
          sortOrder: 0,
          createdAt: '2025-01-01T00:00:00Z',
        },
      ],
    })

    render(<ConnectionForm />)
    await switchToTab(user, 'advanced')

    const combobox = screen.getByRole('combobox', { name: 'Group' })
    await user.click(combobox)
    await user.click(screen.getByRole('option', { name: 'Production' }))
    expect(combobox).toHaveTextContent('Production')
  })

  it('renders color picker swatch', async () => {
    const user = userEvent.setup()
    render(<ConnectionForm />)
    await switchToTab(user, 'advanced')
    expect(screen.getByLabelText('Choose color')).toBeInTheDocument()
  })

  it('color picker opens popover on click', async () => {
    const user = userEvent.setup()
    render(<ConnectionForm />)
    await switchToTab(user, 'advanced')

    const swatch = screen.getByLabelText('Choose color')
    await user.click(swatch)

    expect(screen.getByTestId('color-picker-popover')).toBeInTheDocument()
    expect(screen.getByLabelText('Hex color value')).toBeInTheDocument()
    expect(screen.getByText('Clear Color')).toBeInTheDocument()
  })

  it('color picker Clear Color button clears the color', async () => {
    const user = userEvent.setup()
    render(<ConnectionForm />)
    await switchToTab(user, 'advanced')

    // Open the popover
    await user.click(screen.getByLabelText('Choose color'))

    // Click clear color
    await user.click(screen.getByText('Clear Color'))

    // Popover should close
    expect(screen.queryByTestId('color-picker-popover')).not.toBeInTheDocument()
  })

  it('color picker hex input accepts valid hex values', async () => {
    const user = userEvent.setup()
    render(<ConnectionForm />)
    await switchToTab(user, 'advanced')

    // Open the popover
    await user.click(screen.getByLabelText('Choose color'))

    const hexInput = screen.getByLabelText('Hex color value')
    await user.clear(hexInput)
    await user.type(hexInput, '#ff0000')

    expect(hexInput).toHaveValue('#ff0000')
  })

  it('color picker closes on outside click', async () => {
    const user = userEvent.setup()
    render(<ConnectionForm />)
    await switchToTab(user, 'advanced')

    // Open the popover
    await user.click(screen.getByLabelText('Choose color'))
    expect(screen.getByTestId('color-picker-popover')).toBeInTheDocument()

    // Click outside (on a form field)
    await user.click(screen.getByLabelText('Connect Timeout'))

    // Popover should close
    expect(screen.queryByTestId('color-picker-popover')).not.toBeInTheDocument()
  })

  it('shows test connection success result', async () => {
    const user = userEvent.setup()
    ipc.override('test_connection', () => ({
      success: true,
      serverVersion: '8.0.35',
      authMethod: 'mysql_native_password',
      sslStatus: 'Not using SSL',
      connectionTimeMs: 42,
      errorMessage: null,
    }))

    render(<ConnectionForm />)

    await user.type(screen.getByLabelText('Connection name'), 'Local')
    await user.type(screen.getByLabelText('Host address'), 'localhost')
    await user.type(screen.getByLabelText('Username'), 'root')
    await user.click(screen.getByText('Test Connection'))

    await waitFor(() => {
      expect(screen.getByText('Connection successful')).toBeInTheDocument()
    })
    expect(screen.getByText('8.0.35')).toBeInTheDocument()
    expect(screen.getByText('42 ms')).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows test connection error result', async () => {
    const user = userEvent.setup()
    ipc.override('test_connection', () => {
      throw new Error('Connection refused')
    })

    render(<ConnectionForm />)

    await user.type(screen.getByLabelText('Connection name'), 'Local')
    await user.type(screen.getByLabelText('Host address'), 'localhost')
    await user.type(screen.getByLabelText('Username'), 'root')
    await user.click(screen.getByText('Test Connection'))

    await waitFor(() => {
      expect(screen.getByText('Connection failed')).toBeInTheDocument()
    })
    expect(screen.getByText('Connection refused')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('SSL fields are disabled when SSL toggle is off', async () => {
    const user = userEvent.setup()
    render(<ConnectionForm />)

    await switchToTab(user, 'ssl')

    expect(screen.getByLabelText('CA Certificate')).toBeDisabled()
    expect(screen.getByLabelText('Client Certificate')).toBeDisabled()
    expect(screen.getByLabelText('Client Key')).toBeDisabled()
  })

  it('SSL fields become enabled when SSL toggle is on', async () => {
    const user = userEvent.setup()
    render(<ConnectionForm />)

    await switchToTab(user, 'ssl')
    await user.click(screen.getByLabelText('Use SSL / TLS'))

    expect(screen.getByLabelText('CA Certificate')).not.toBeDisabled()
    expect(screen.getByLabelText('Client Certificate')).not.toBeDisabled()
    expect(screen.getByLabelText('Client Key')).not.toBeDisabled()
  })

  it('Browse buttons are disabled when SSL is off', async () => {
    const user = userEvent.setup()
    render(<ConnectionForm />)

    await switchToTab(user, 'ssl')

    expect(screen.getByLabelText('Browse CA certificate')).toBeDisabled()
    expect(screen.getByLabelText('Browse client certificate')).toBeDisabled()
    expect(screen.getByLabelText('Browse client key')).toBeDisabled()
  })

  it('file browse buttons call native dialog', async () => {
    const user = userEvent.setup()
    ipc.override('plugin:dialog|open', () => '/path/to/ca.pem')

    render(<ConnectionForm />)

    // Enable SSL first
    await switchToTab(user, 'ssl')
    await user.click(screen.getByLabelText('Use SSL / TLS'))

    // Click browse for CA cert
    await user.click(screen.getByLabelText('Browse CA certificate'))

    await waitFor(() => {
      expect(ipc.calls('plugin:dialog|open')).toHaveLength(1)
    })

    // Check that the file path was set
    expect(screen.getByLabelText('CA Certificate')).toHaveValue('/path/to/ca.pem')
  })

  it('file browse handles user cancellation gracefully', async () => {
    const user = userEvent.setup()
    ipc.override('plugin:dialog|open', () => null)

    render(<ConnectionForm />)

    await switchToTab(user, 'ssl')
    await user.click(screen.getByLabelText('Use SSL / TLS'))
    await user.click(screen.getByLabelText('Browse client certificate'))

    await waitFor(() => {
      expect(ipc.calls('plugin:dialog|open')).toHaveLength(1)
    })

    // Field should remain empty
    expect(screen.getByLabelText('Client Certificate')).toHaveValue('')
  })

  it('Save and Connect button saves new connection and opens it', async () => {
    const user = userEvent.setup()
    ipc.override('save_connection', () => 'new-conn-id')
    ipc.override('list_connections', () => [
      makeSavedConnection({ id: 'new-conn-id', name: 'Local', host: 'localhost' }),
    ])
    ipc.override('open_connection', () => ({ sessionId: 'sess-test-1', serverVersion: '8.0.35' }))

    useConnectionStore.setState({ dialogOpen: true })
    render(<ConnectionForm />)

    await user.type(screen.getByLabelText('Connection name'), 'Local')
    await user.type(screen.getByLabelText('Host address'), 'localhost')
    await user.type(screen.getByLabelText('Username'), 'root')
    await user.click(screen.getByText('Save and Connect'))

    await waitFor(() => {
      expect(ipc.calls('save_connection')).toHaveLength(1)
      expect(ipc.calls('open_connection')).toHaveLength(1)
    })
  })

  it('Save and Connect button closes dialog after connecting', async () => {
    const user = userEvent.setup()
    ipc.override('save_connection', () => 'new-conn-id')
    ipc.override('list_connections', () => [
      makeSavedConnection({ id: 'new-conn-id', name: 'Local', host: 'localhost' }),
    ])
    ipc.override('open_connection', () => ({ sessionId: 'sess-test-1', serverVersion: '8.0.35' }))

    useConnectionStore.setState({ dialogOpen: true })
    render(<ConnectionForm />)

    await user.type(screen.getByLabelText('Connection name'), 'Local')
    await user.type(screen.getByLabelText('Host address'), 'localhost')
    await user.type(screen.getByLabelText('Username'), 'root')
    await user.click(screen.getByText('Save and Connect'))

    await waitFor(() => {
      expect(useConnectionStore.getState().dialogOpen).toBe(false)
    })
  })

  it('Save and Connect shows error on failure', async () => {
    const user = userEvent.setup()
    ipc.override('save_connection', () => {
      throw new Error('Save failed')
    })

    render(<ConnectionForm />)

    await user.type(screen.getByLabelText('Connection name'), 'Local')
    await user.type(screen.getByLabelText('Host address'), 'localhost')
    await user.type(screen.getByLabelText('Username'), 'root')
    await user.click(screen.getByText('Save and Connect'))

    await waitFor(() => {
      expect(screen.getByText('Connection failed')).toBeInTheDocument()
      expect(screen.getByText('Save failed')).toBeInTheDocument()
    })
  })

  it('Save shows error on failure', async () => {
    const user = userEvent.setup()
    ipc.override('save_connection', () => {
      throw new Error('Database error')
    })

    render(<ConnectionForm />)

    await user.type(screen.getByLabelText('Connection name'), 'Local')
    await user.type(screen.getByLabelText('Host address'), 'localhost')
    await user.type(screen.getByLabelText('Username'), 'root')
    await user.click(screen.getByText('Save'))

    await waitFor(() => {
      expect(screen.getByText('Database error')).toBeInTheDocument()
    })
  })

  it('form fields accept input correctly', async () => {
    const user = userEvent.setup()
    render(<ConnectionForm />)

    const nameInput = screen.getByLabelText('Connection name')
    await user.type(nameInput, 'My Server')
    expect(nameInput).toHaveValue('My Server')

    const hostInput = screen.getByLabelText('Host address')
    await user.type(hostInput, '192.168.1.1')
    expect(hostInput).toHaveValue('192.168.1.1')

    const dbInput = screen.getByLabelText('Default Database')
    await user.type(dbInput, 'mydb')
    expect(dbInput).toHaveValue('mydb')
  })

  it('renders timeout and access-mode fields', async () => {
    const user = userEvent.setup()
    render(<ConnectionForm />)
    await switchToTab(user, 'advanced')

    expect(screen.getByRole('combobox', { name: 'Access mode' })).toBeInTheDocument()
    expect(screen.getByLabelText('Connect Timeout')).toBeInTheDocument()
    expect(screen.getByLabelText('Keepalive Interval')).toBeInTheDocument()
  })

  it('Advanced fields accept input', async () => {
    const user = userEvent.setup()
    render(<ConnectionForm />)
    await switchToTab(user, 'advanced')

    // Switch access mode to read-only
    const accessMode = screen.getByRole('combobox', { name: 'Access mode' })
    expect(accessMode).toHaveTextContent('Allow writes (read-write)')
    await user.click(accessMode)
    await user.click(screen.getByRole('option', { name: 'Read-only (block writes)' }))
    expect(accessMode).toHaveTextContent('Read-only (block writes)')

    // Check timeout has default value
    const timeoutInput = screen.getByLabelText('Connect Timeout')
    expect(timeoutInput).toHaveValue(10)

    // Check keepalive has default value
    const keepaliveInput = screen.getByLabelText('Keepalive Interval')
    expect(keepaliveInput).toHaveValue(60)
  })

  it('populates form fields when editingConnection is provided', () => {
    const editConn = makeSavedConnection({
      name: 'Prod DB',
      host: '10.0.0.1',
      port: 3307,
      username: 'admin',
      defaultDatabase: 'production',
    })

    render(<ConnectionForm editingConnection={editConn} />)

    expect(screen.getByLabelText('Connection name')).toHaveValue('Prod DB')
    expect(screen.getByLabelText('Host address')).toHaveValue('10.0.0.1')
    expect(screen.getByLabelText('Port')).toHaveValue(3307)
    expect(screen.getByLabelText('Username')).toHaveValue('admin')
    expect(screen.getByLabelText('Default Database')).toHaveValue('production')
    // Password should be empty (user re-enters)
    expect(screen.getByLabelText('Password')).toHaveValue('')
  })

  it('password shows placeholder when editing connection with password', () => {
    const editConn = makeSavedConnection({ hasPassword: true })

    render(<ConnectionForm editingConnection={editConn} />)

    expect(screen.getByLabelText('Password')).toHaveAttribute('placeholder', '••••••••')
  })

  it('shows remove saved password option when editing a connection with password', () => {
    const editConn = makeSavedConnection({ hasPassword: true })

    render(<ConnectionForm editingConnection={editConn} />)

    expect(screen.getByLabelText('Use no password (remove saved password)')).toBeInTheDocument()
  })

  it('shows a Delete button when editing a saved connection', () => {
    const editConn = makeSavedConnection()

    render(<ConnectionForm editingConnection={editConn} />)

    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('Save can clear an existing saved password', async () => {
    const user = userEvent.setup()
    const editConn = makeSavedConnection({ hasPassword: true })

    ipc.override('update_connection', () => undefined)

    render(<ConnectionForm editingConnection={editConn} />)

    await user.click(screen.getByLabelText('Use no password (remove saved password)'))
    await user.click(screen.getByText('Save'))

    await waitFor(() => {
      const calls = ipc.calls('update_connection')
      expect(calls).toHaveLength(1)
      expect((calls[0] as Record<string, unknown>)?.data).toMatchObject({
        clearPassword: true,
        password: null,
      })
    })
  })

  it('Delete removes the currently viewed saved connection', async () => {
    const user = userEvent.setup()
    const onDeleteConnection = vi.fn()
    const editConn = makeSavedConnection()

    ipc.override('delete_connection', () => undefined)

    render(<ConnectionForm editingConnection={editConn} onDeleteConnection={onDeleteConnection} />)

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByRole('heading', { name: 'Delete Connection' })).toBeInTheDocument()
    expect(screen.getByText(/Delete saved connection/i)).toBeInTheDocument()

    await user.click(screen.getByTestId('confirm-confirm-button'))

    await waitFor(() => {
      expect(ipc.calls('delete_connection')).toHaveLength(1)
      expect(onDeleteConnection).toHaveBeenCalledWith('conn-1')
    })

    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Connection name')).toHaveValue('')
  })

  it('typing a new password is blocked while clear password mode is enabled', async () => {
    const user = userEvent.setup()
    const editConn = makeSavedConnection({ hasPassword: true })

    render(<ConnectionForm editingConnection={editConn} />)

    const clearCheckbox = screen.getByLabelText('Use no password (remove saved password)')
    const passwordInput = screen.getByLabelText('Password')
    await user.click(clearCheckbox)
    expect(clearCheckbox).toBeChecked()
    expect(passwordInput).toBeDisabled()

    await user.type(passwordInput, 'new-secret')
    expect(clearCheckbox).toBeChecked()
    expect(passwordInput).toHaveValue('')
  })

  it('clear password mode disables and clears the password field', async () => {
    const user = userEvent.setup()
    const editConn = makeSavedConnection({ hasPassword: true })

    render(<ConnectionForm editingConnection={editConn} />)

    const passwordInput = screen.getByLabelText('Password')
    await user.type(passwordInput, 'new-secret')
    expect(passwordInput).toHaveValue('new-secret')

    await user.click(screen.getByLabelText('Use no password (remove saved password)'))

    expect(passwordInput).toHaveValue('')
    expect(passwordInput).toBeDisabled()
  })

  it('shows remove saved password option after saving a new password', async () => {
    const user = userEvent.setup()

    ipc.override('save_connection', () => 'new-uuid-123')

    render(<ConnectionForm />)

    await user.type(screen.getByLabelText('Connection name'), 'Local')
    await user.type(screen.getByLabelText('Host address'), 'localhost')
    await user.type(screen.getByLabelText('Username'), 'root')
    await user.type(screen.getByLabelText('Password'), 'secret')
    await user.click(screen.getByText('Save'))

    await waitFor(() => {
      expect(screen.getByLabelText('Use no password (remove saved password)')).toBeInTheDocument()
    })
  })

  it('editing a passwordless connection does not invent saved password state when typed password is cleared', async () => {
    const user = userEvent.setup()
    const editConn = makeSavedConnection({ hasPassword: false })

    ipc.override('update_connection', () => undefined)

    render(<ConnectionForm editingConnection={editConn} />)

    const passwordInput = screen.getByLabelText('Password')
    expect(passwordInput).toHaveAttribute('placeholder', '')
    expect(
      screen.queryByLabelText('Use no password (remove saved password)')
    ).not.toBeInTheDocument()

    await user.type(passwordInput, 'secret')
    await user.clear(passwordInput)
    await user.click(screen.getByText('Save'))

    await waitFor(() => {
      const calls = ipc.calls('update_connection')
      expect(calls).toHaveLength(1)
      expect((calls[0] as Record<string, unknown>)?.data).toMatchObject({
        clearPassword: false,
        password: null,
      })
    })

    expect(
      screen.queryByLabelText('Use no password (remove saved password)')
    ).not.toBeInTheDocument()
    expect(passwordInput).toHaveAttribute('placeholder', '')
  })

  it('Save calls updateConnection after previous save (no duplicates)', async () => {
    const user = userEvent.setup()
    ipc.override('save_connection', () => 'new-uuid-123')

    render(<ConnectionForm />)

    await user.type(screen.getByLabelText('Connection name'), 'Local')
    await user.type(screen.getByLabelText('Host address'), 'localhost')
    await user.type(screen.getByLabelText('Username'), 'root')

    // First save — should call save_connection
    await user.click(screen.getByText('Save'))
    await waitFor(() => {
      expect(ipc.calls('save_connection')).toHaveLength(1)
    })

    // Now override update_connection for the second save
    ipc.override('update_connection', () => undefined)

    // Second save — should call update_connection instead of save_connection
    await user.click(screen.getByText('Save'))
    await waitFor(() => {
      const updateCalls = ipc.calls('update_connection')
      expect(updateCalls).toHaveLength(1)
      expect((updateCalls[0] as Record<string, unknown>)?.id).toBe('new-uuid-123')
    })
    expect(ipc.calls('save_connection')).toHaveLength(1) // still only 1
  })

  it('Save and Connect updates existing connection before opening', async () => {
    const user = userEvent.setup()
    const editConn = makeSavedConnection()

    ipc.override('update_connection', () => undefined)
    ipc.override('list_connections', () => [editConn])
    ipc.override('open_connection', () => ({ sessionId: 'sess-test-1', serverVersion: '8.0.35' }))

    useConnectionStore.setState({
      dialogOpen: true,
      savedConnections: [editConn],
    })

    render(<ConnectionForm editingConnection={editConn} />)

    // Edit the host
    const hostInput = screen.getByLabelText('Host address')
    await user.clear(hostInput)
    await user.type(hostInput, '10.0.0.1')

    await user.click(screen.getByText('Save and Connect'))

    await waitFor(() => {
      expect(ipc.calls('update_connection')).toHaveLength(1)
      expect(ipc.calls('open_connection')).toHaveLength(1)
    })
  })

  it('Save and Connect does not close dialog on openConnection failure', async () => {
    const user = userEvent.setup()
    ipc.override('save_connection', () => 'new-conn-id')
    ipc.override('list_connections', () => [
      makeSavedConnection({ id: 'new-conn-id', name: 'Local', host: 'localhost' }),
    ])
    ipc.override('open_connection', () => {
      throw new Error('Connection refused')
    })

    useConnectionStore.setState({ dialogOpen: true })
    render(<ConnectionForm />)

    await user.type(screen.getByLabelText('Connection name'), 'Local')
    await user.type(screen.getByLabelText('Host address'), 'localhost')
    await user.type(screen.getByLabelText('Username'), 'root')
    await user.click(screen.getByText('Save and Connect'))

    await waitFor(() => {
      expect(screen.getByText('Connection refused')).toBeInTheDocument()
    })
    // Dialog should stay open
    expect(useConnectionStore.getState().dialogOpen).toBe(true)
  })

  it('Save calls updateConnection when editing', async () => {
    const user = userEvent.setup()
    const editConn = makeSavedConnection()

    ipc.override('update_connection', () => undefined)

    render(<ConnectionForm editingConnection={editConn} />)

    await user.click(screen.getByText('Save'))

    await waitFor(() => {
      expect(ipc.calls('update_connection')).toHaveLength(1)
    })
  })

  it('SSL text fields update when typing', async () => {
    const user = userEvent.setup()
    render(<ConnectionForm />)

    // Enable SSL
    await switchToTab(user, 'ssl')
    await user.click(screen.getByLabelText('Use SSL / TLS'))

    // Type in CA cert field
    const caInput = screen.getByLabelText('CA Certificate')
    await user.type(caInput, '/path/to/ca.pem')
    expect(caInput).toHaveValue('/path/to/ca.pem')
  })

  it('default database clears to null on empty input', async () => {
    const user = userEvent.setup()
    const editConn = makeSavedConnection({ defaultDatabase: 'mydb' })

    ipc.override('update_connection', () => undefined)

    render(<ConnectionForm editingConnection={editConn} />)

    const dbInput = screen.getByLabelText('Default Database')
    expect(dbInput).toHaveValue('mydb')

    await user.clear(dbInput)
    expect(dbInput).toHaveValue('')
  })

  it('reads default timeout and keepalive from settings store', async () => {
    const user = userEvent.setup()
    useSettingsStore.setState({
      settings: {
        'connection.defaultTimeout': '30',
        'connection.defaultKeepalive': '120',
      },
      pendingChanges: {},
    })

    render(<ConnectionForm />)
    await switchToTab(user, 'advanced')

    const timeoutInput = screen.getByLabelText('Connect Timeout')
    expect(timeoutInput).toHaveValue(30)

    const keepaliveInput = screen.getByLabelText('Keepalive Interval')
    expect(keepaliveInput).toHaveValue(120)
  })

  it('validation from another tab switches to the first tab with errors and shows error dot', async () => {
    const user = userEvent.setup()
    render(<ConnectionForm />)

    await switchToTab(user, 'advanced')
    await user.click(screen.getByText('Save'))

    expect(screen.getByTestId('connection-form-panel-general')).toBeInTheDocument()
    expect(screen.getByText('Connection name is required')).toBeInTheDocument()
    const generalTab = screen.getByTestId('connection-form-tab-general')
    expect(generalTab.querySelector('[aria-label="Has errors"]')).toBeInTheDocument()
  })

  it('tab error dot clears when the field is fixed', async () => {
    const user = userEvent.setup()
    render(<ConnectionForm />)

    await user.click(screen.getByText('Save'))
    const generalTab = screen.getByTestId('connection-form-tab-general')
    expect(generalTab.querySelector('[aria-label="Has errors"]')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Connection name'), 'Local')
    await user.type(screen.getByLabelText('Host address'), 'localhost')
    await user.type(screen.getByLabelText('Username'), 'root')
    expect(generalTab.querySelector('[aria-label="Has errors"]')).not.toBeInTheDocument()
  })

  it('resets to the General tab when editingConnection changes', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<ConnectionForm />)

    await switchToTab(user, 'advanced')
    expect(screen.getByTestId('connection-form-panel-advanced')).toBeInTheDocument()

    rerender(<ConnectionForm editingConnection={makeSavedConnection()} />)
    expect(screen.getByTestId('connection-form-panel-general')).toBeInTheDocument()
    expect(screen.queryByTestId('connection-form-panel-advanced')).not.toBeInTheDocument()
  })

  it('form header shows connection name, user@host:port and updates with input', async () => {
    const user = userEvent.setup()
    render(<ConnectionForm />)

    const header = screen.getByTestId('connection-form-header')
    expect(header).toHaveTextContent('New Connection')

    await user.type(screen.getByLabelText('Connection name'), 'My DB')
    await user.type(screen.getByLabelText('Host address'), 'db.local')
    await user.type(screen.getByLabelText('Username'), 'root')
    expect(header).toHaveTextContent('My DB')
    expect(header).toHaveTextContent('root@db.local:3306')
  })
})
