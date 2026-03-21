import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConnectionForm } from '../../components/connection-dialog/ConnectionForm'
import { useConnectionStore } from '../../stores/connection-store'
import type { SavedConnection } from '../../types/connection'

// Mock IPC
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
const mockInvoke = vi.mocked(invoke)
const mockOpen = vi.mocked(open)

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
  mockInvoke.mockReset()
  mockOpen.mockReset()

  useConnectionStore.setState({
    savedConnections: [],
    connectionGroups: [],
    activeConnections: {},
    activeTabId: null,
    dialogOpen: false,
    error: null,
  })
})

describe('ConnectionForm', () => {
  it('renders all basic form fields', () => {
    render(<ConnectionForm />)

    expect(screen.getByLabelText('Connection Name')).toBeInTheDocument()
    expect(screen.getByLabelText('Host address')).toBeInTheDocument()
    expect(screen.getByLabelText('Port')).toBeInTheDocument()
    expect(screen.getByLabelText('Username')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByLabelText('Default Database')).toBeInTheDocument()
  })

  it('renders SSL certificate files collapsible section', () => {
    render(<ConnectionForm />)
    expect(screen.getByText('SSL certificate files')).toBeInTheDocument()
  })

  it('SSL section expands and collapses', async () => {
    const user = userEvent.setup()
    render(<ConnectionForm />)

    const sslButton = screen.getByRole('button', { name: /SSL certificate files/ })

    // Initially collapsed
    expect(sslButton).toHaveAttribute('aria-expanded', 'false')

    // Click to expand
    await user.click(sslButton)
    expect(sslButton).toHaveAttribute('aria-expanded', 'true')

    // Click to collapse
    await user.click(sslButton)
    expect(sslButton).toHaveAttribute('aria-expanded', 'false')
  })

  it('Test Connection button calls testConnection IPC', async () => {
    const user = userEvent.setup()
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'test_connection')
        return Promise.resolve({
          success: true,
          serverVersion: '8.0.35',
          authMethod: 'mysql_native_password',
          sslStatus: 'Not using SSL',
          connectionTimeMs: 42,
          errorMessage: null,
        })
      return Promise.resolve([])
    })

    render(<ConnectionForm />)

    await user.type(screen.getByLabelText('Host address'), 'localhost')
    await user.type(screen.getByLabelText('Username'), 'root')
    await user.click(screen.getByText('Test Connection'))

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('test_connection', expect.any(Object))
    })
  })

  it('Save button calls saveConnection IPC', async () => {
    const user = userEvent.setup()
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'save_connection') return Promise.resolve('new-uuid-123')
      if (cmd === 'list_connections') return Promise.resolve([])
      if (cmd === 'list_connection_groups') return Promise.resolve([])
      return Promise.resolve(null)
    })

    render(<ConnectionForm />)

    await user.type(screen.getByLabelText('Host address'), 'localhost')
    await user.type(screen.getByLabelText('Username'), 'root')
    await user.click(screen.getByText('Save'))

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('save_connection', expect.any(Object))
    })
  })

  it('form validation shows errors for missing Host', async () => {
    const user = userEvent.setup()
    render(<ConnectionForm />)

    await user.type(screen.getByLabelText('Username'), 'root')
    await user.click(screen.getByText('Test Connection'))

    expect(screen.getByText('Host is required')).toBeInTheDocument()
  })

  it('form validation shows errors for missing Username', async () => {
    const user = userEvent.setup()
    render(<ConnectionForm />)

    await user.type(screen.getByLabelText('Host address'), 'localhost')
    await user.click(screen.getByText('Test Connection'))

    expect(screen.getByText('Username is required')).toBeInTheDocument()
  })

  it('validation errors clear when field is filled', async () => {
    const user = userEvent.setup()
    render(<ConnectionForm />)

    await user.click(screen.getByText('Test Connection'))
    expect(screen.getByText('Host is required')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Host address'), 'localhost')
    expect(screen.queryByText('Host is required')).not.toBeInTheDocument()
  })

  it('Save validation prevents save with empty fields', async () => {
    const user = userEvent.setup()
    render(<ConnectionForm />)

    await user.click(screen.getByText('Save'))

    expect(screen.getByText('Host is required')).toBeInTheDocument()
    expect(screen.getByText('Username is required')).toBeInTheDocument()
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('Connect validation prevents connect with empty fields', async () => {
    const user = userEvent.setup()
    render(<ConnectionForm />)

    await user.click(screen.getByText('Connect'))

    expect(screen.getByText('Host is required')).toBeInTheDocument()
    expect(mockInvoke).not.toHaveBeenCalled()
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
    expect(screen.getByText('Connect')).toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'Test Connection' })).toHaveClass('ui-button-test')
    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass('ui-button-secondary')
    expect(screen.getByRole('button', { name: 'Connect' })).toHaveClass('ui-button-primary')
  })

  it('renders group selector with Ungrouped option', () => {
    render(<ConnectionForm />)

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

    const combobox = screen.getByRole('combobox', { name: 'Group' })
    await user.click(combobox)
    await user.click(screen.getByRole('option', { name: 'Production' }))
    expect(combobox).toHaveTextContent('Production')
  })

  it('renders color picker swatch', () => {
    render(<ConnectionForm />)
    expect(screen.getByLabelText('Choose color')).toBeInTheDocument()
  })

  it('color picker opens popover on click', async () => {
    const user = userEvent.setup()
    render(<ConnectionForm />)

    const swatch = screen.getByLabelText('Choose color')
    await user.click(swatch)

    expect(screen.getByTestId('color-picker-popover')).toBeInTheDocument()
    expect(screen.getByLabelText('Hex color value')).toBeInTheDocument()
    expect(screen.getByText('Clear Color')).toBeInTheDocument()
  })

  it('color picker Clear Color button clears the color', async () => {
    const user = userEvent.setup()
    render(<ConnectionForm />)

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

    // Open the popover
    await user.click(screen.getByLabelText('Choose color'))
    expect(screen.getByTestId('color-picker-popover')).toBeInTheDocument()

    // Click outside (on a form field)
    await user.click(screen.getByLabelText('Connection Name'))

    // Popover should close
    expect(screen.queryByTestId('color-picker-popover')).not.toBeInTheDocument()
  })

  it('shows test connection success result', async () => {
    const user = userEvent.setup()
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'test_connection')
        return Promise.resolve({
          success: true,
          serverVersion: '8.0.35',
          authMethod: 'mysql_native_password',
          sslStatus: 'Not using SSL',
          connectionTimeMs: 42,
          errorMessage: null,
        })
      return Promise.resolve([])
    })

    render(<ConnectionForm />)

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
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'test_connection') return Promise.reject(new Error('Connection refused'))
      return Promise.resolve([])
    })

    render(<ConnectionForm />)

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

    await user.click(screen.getByRole('button', { name: /SSL certificate files/ }))

    expect(screen.getByLabelText('CA Certificate')).toBeDisabled()
    expect(screen.getByLabelText('Client Certificate')).toBeDisabled()
    expect(screen.getByLabelText('Client Key')).toBeDisabled()
  })

  it('SSL fields become enabled when SSL toggle is on', async () => {
    const user = userEvent.setup()
    render(<ConnectionForm />)

    await user.click(screen.getByLabelText('Use SSL / TLS'))
    await user.click(screen.getByRole('button', { name: /SSL certificate files/ }))

    expect(screen.getByLabelText('CA Certificate')).not.toBeDisabled()
    expect(screen.getByLabelText('Client Certificate')).not.toBeDisabled()
    expect(screen.getByLabelText('Client Key')).not.toBeDisabled()
  })

  it('Browse buttons are disabled when SSL is off', async () => {
    const user = userEvent.setup()
    render(<ConnectionForm />)

    await user.click(screen.getByRole('button', { name: /SSL certificate files/ }))

    expect(screen.getByLabelText('Browse CA certificate')).toBeDisabled()
    expect(screen.getByLabelText('Browse client certificate')).toBeDisabled()
    expect(screen.getByLabelText('Browse client key')).toBeDisabled()
  })

  it('file browse buttons call native dialog', async () => {
    const user = userEvent.setup()
    mockOpen.mockResolvedValue('/path/to/ca.pem')

    render(<ConnectionForm />)

    // Enable SSL first
    await user.click(screen.getByLabelText('Use SSL / TLS'))
    await user.click(screen.getByRole('button', { name: /SSL certificate files/ }))

    // Click browse for CA cert
    await user.click(screen.getByLabelText('Browse CA certificate'))

    await waitFor(() => {
      expect(mockOpen).toHaveBeenCalledWith(
        expect.objectContaining({
          filters: [{ name: 'Certificates', extensions: ['pem', 'crt', 'key'] }],
        })
      )
    })

    // Check that the file path was set
    expect(screen.getByLabelText('CA Certificate')).toHaveValue('/path/to/ca.pem')
  })

  it('file browse handles user cancellation gracefully', async () => {
    const user = userEvent.setup()
    mockOpen.mockResolvedValue(null)

    render(<ConnectionForm />)

    await user.click(screen.getByLabelText('Use SSL / TLS'))
    await user.click(screen.getByRole('button', { name: /SSL certificate files/ }))
    await user.click(screen.getByLabelText('Browse client certificate'))

    await waitFor(() => {
      expect(mockOpen).toHaveBeenCalled()
    })

    // Field should remain empty
    expect(screen.getByLabelText('Client Certificate')).toHaveValue('')
  })

  it('Connect button saves new connection and opens it', async () => {
    const user = userEvent.setup()
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'save_connection') return Promise.resolve('new-conn-id')
      if (cmd === 'list_connections')
        return Promise.resolve([
          makeSavedConnection({ id: 'new-conn-id', name: '', host: 'localhost' }),
        ])
      if (cmd === 'list_connection_groups') return Promise.resolve([])
      if (cmd === 'open_connection') return Promise.resolve({ serverVersion: '8.0.35' })
      return Promise.resolve(null)
    })

    useConnectionStore.setState({ dialogOpen: true })
    render(<ConnectionForm />)

    await user.type(screen.getByLabelText('Host address'), 'localhost')
    await user.type(screen.getByLabelText('Username'), 'root')
    await user.click(screen.getByText('Connect'))

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('save_connection', expect.any(Object))
      expect(mockInvoke).toHaveBeenCalledWith('open_connection', expect.any(Object))
    })
  })

  it('Connect button closes dialog after connecting', async () => {
    const user = userEvent.setup()
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'save_connection') return Promise.resolve('new-conn-id')
      if (cmd === 'list_connections')
        return Promise.resolve([
          makeSavedConnection({ id: 'new-conn-id', name: '', host: 'localhost' }),
        ])
      if (cmd === 'list_connection_groups') return Promise.resolve([])
      if (cmd === 'open_connection') return Promise.resolve({ serverVersion: '8.0.35' })
      return Promise.resolve(null)
    })

    useConnectionStore.setState({ dialogOpen: true })
    render(<ConnectionForm />)

    await user.type(screen.getByLabelText('Host address'), 'localhost')
    await user.type(screen.getByLabelText('Username'), 'root')
    await user.click(screen.getByText('Connect'))

    await waitFor(() => {
      expect(useConnectionStore.getState().dialogOpen).toBe(false)
    })
  })

  it('Connect shows error on failure', async () => {
    const user = userEvent.setup()
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'save_connection') return Promise.reject(new Error('Save failed'))
      return Promise.resolve([])
    })

    render(<ConnectionForm />)

    await user.type(screen.getByLabelText('Host address'), 'localhost')
    await user.type(screen.getByLabelText('Username'), 'root')
    await user.click(screen.getByText('Connect'))

    await waitFor(() => {
      expect(screen.getByText('Connection failed')).toBeInTheDocument()
      expect(screen.getByText('Save failed')).toBeInTheDocument()
    })
  })

  it('Save shows error on failure', async () => {
    const user = userEvent.setup()
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'save_connection') return Promise.reject(new Error('Database error'))
      return Promise.resolve([])
    })

    render(<ConnectionForm />)

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

    const nameInput = screen.getByLabelText('Connection Name')
    await user.type(nameInput, 'My Server')
    expect(nameInput).toHaveValue('My Server')

    const hostInput = screen.getByLabelText('Host address')
    await user.type(hostInput, '192.168.1.1')
    expect(hostInput).toHaveValue('192.168.1.1')

    const dbInput = screen.getByLabelText('Default Database')
    await user.type(dbInput, 'mydb')
    expect(dbInput).toHaveValue('mydb')
  })

  it('renders timeout and read-only fields', () => {
    render(<ConnectionForm />)

    expect(screen.getByLabelText('Read Only')).toBeInTheDocument()
    expect(screen.getByLabelText('Connect Timeout')).toBeInTheDocument()
    expect(screen.getByLabelText('Keepalive Interval')).toBeInTheDocument()
  })

  it('Advanced fields accept input', async () => {
    const user = userEvent.setup()
    render(<ConnectionForm />)

    // Toggle read-only
    const readOnlyCheckbox = screen.getByLabelText('Read Only')
    await user.click(readOnlyCheckbox)
    expect(readOnlyCheckbox).toBeChecked()

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

    expect(screen.getByLabelText('Connection Name')).toHaveValue('Prod DB')
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

  it('Save calls updateConnection after previous save (no duplicates)', async () => {
    const user = userEvent.setup()
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'save_connection') return Promise.resolve('new-uuid-123')
      if (cmd === 'update_connection') return Promise.resolve(undefined)
      if (cmd === 'list_connections') return Promise.resolve([])
      if (cmd === 'list_connection_groups') return Promise.resolve([])
      return Promise.resolve(null)
    })

    render(<ConnectionForm />)

    await user.type(screen.getByLabelText('Host address'), 'localhost')
    await user.type(screen.getByLabelText('Username'), 'root')

    // First save — should call save_connection
    await user.click(screen.getByText('Save'))
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('save_connection', expect.any(Object))
    })

    mockInvoke.mockClear()
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'update_connection') return Promise.resolve(undefined)
      if (cmd === 'list_connections') return Promise.resolve([])
      if (cmd === 'list_connection_groups') return Promise.resolve([])
      return Promise.resolve(null)
    })

    // Second save — should call update_connection instead of save_connection
    await user.click(screen.getByText('Save'))
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        'update_connection',
        expect.objectContaining({ id: 'new-uuid-123' })
      )
    })
    expect(mockInvoke).not.toHaveBeenCalledWith('save_connection', expect.any(Object))
  })

  it('Connect updates existing connection before opening', async () => {
    const user = userEvent.setup()
    const editConn = makeSavedConnection()

    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'update_connection') return Promise.resolve(undefined)
      if (cmd === 'list_connections') return Promise.resolve([editConn])
      if (cmd === 'list_connection_groups') return Promise.resolve([])
      if (cmd === 'open_connection') return Promise.resolve({ serverVersion: '8.0.35' })
      return Promise.resolve(null)
    })

    useConnectionStore.setState({
      dialogOpen: true,
      savedConnections: [editConn],
    })

    render(<ConnectionForm editingConnection={editConn} />)

    // Edit the host
    const hostInput = screen.getByLabelText('Host address')
    await user.clear(hostInput)
    await user.type(hostInput, '10.0.0.1')

    await user.click(screen.getByText('Connect'))

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('update_connection', expect.any(Object))
      expect(mockInvoke).toHaveBeenCalledWith('open_connection', expect.any(Object))
    })
  })

  it('Connect does not close dialog on openConnection failure', async () => {
    const user = userEvent.setup()
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'save_connection') return Promise.resolve('new-conn-id')
      if (cmd === 'list_connections')
        return Promise.resolve([
          makeSavedConnection({ id: 'new-conn-id', name: '', host: 'localhost' }),
        ])
      if (cmd === 'list_connection_groups') return Promise.resolve([])
      if (cmd === 'open_connection') return Promise.reject(new Error('Connection refused'))
      return Promise.resolve(null)
    })

    useConnectionStore.setState({ dialogOpen: true })
    render(<ConnectionForm />)

    await user.type(screen.getByLabelText('Host address'), 'localhost')
    await user.type(screen.getByLabelText('Username'), 'root')
    await user.click(screen.getByText('Connect'))

    await waitFor(() => {
      expect(screen.getByText('Connection refused')).toBeInTheDocument()
    })
    // Dialog should stay open
    expect(useConnectionStore.getState().dialogOpen).toBe(true)
  })

  it('Save calls updateConnection when editing', async () => {
    const user = userEvent.setup()
    const editConn = makeSavedConnection()

    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'update_connection') return Promise.resolve(undefined)
      if (cmd === 'list_connections') return Promise.resolve([])
      if (cmd === 'list_connection_groups') return Promise.resolve([])
      return Promise.resolve(null)
    })

    render(<ConnectionForm editingConnection={editConn} />)

    await user.click(screen.getByText('Save'))

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('update_connection', expect.any(Object))
    })
  })

  it('SSL text fields update when typing', async () => {
    const user = userEvent.setup()
    render(<ConnectionForm />)

    // Enable SSL
    await user.click(screen.getByLabelText('Use SSL / TLS'))
    await user.click(screen.getByRole('button', { name: /SSL certificate files/ }))

    // Type in CA cert field
    const caInput = screen.getByLabelText('CA Certificate')
    await user.type(caInput, '/path/to/ca.pem')
    expect(caInput).toHaveValue('/path/to/ca.pem')
  })

  it('default database clears to null on empty input', async () => {
    const user = userEvent.setup()
    const editConn = makeSavedConnection({ defaultDatabase: 'mydb' })

    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'update_connection') return Promise.resolve(undefined)
      if (cmd === 'list_connections') return Promise.resolve([])
      if (cmd === 'list_connection_groups') return Promise.resolve([])
      return Promise.resolve(null)
    })

    render(<ConnectionForm editingConnection={editConn} />)

    const dbInput = screen.getByLabelText('Default Database')
    expect(dbInput).toHaveValue('mydb')

    await user.clear(dbInput)
    expect(dbInput).toHaveValue('')
  })
})
