import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConnectionDialog } from '../../components/connection-dialog/ConnectionDialog'
import { useConnectionStore } from '../../stores/connection-store'
import type { SavedConnection } from '../../types/connection'

// Mock IPC
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue([]),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'
const mockInvoke = vi.mocked(invoke)

// Polyfill HTMLDialogElement methods for jsdom
const showModalMock = vi.fn(function (this: HTMLDialogElement) {
  this.setAttribute('open', '')
})
const closeMock = vi.fn(function (this: HTMLDialogElement) {
  this.removeAttribute('open')
})

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = showModalMock
  HTMLDialogElement.prototype.close = closeMock
  showModalMock.mockClear()
  closeMock.mockClear()
  mockInvoke.mockReset()
  mockInvoke.mockResolvedValue([])

  useConnectionStore.setState({
    savedConnections: [],
    connectionGroups: [],
    activeConnections: {},
    activeTabId: null,
    dialogOpen: false,
    error: null,
  })
})

describe('ConnectionDialog', () => {
  it('calls showModal when dialogOpen is true', async () => {
    render(<ConnectionDialog />)

    await act(async () => {
      useConnectionStore.setState({ dialogOpen: true })
    })

    expect(showModalMock).toHaveBeenCalled()
  })

  it('calls close when dialogOpen becomes false', async () => {
    useConnectionStore.setState({ dialogOpen: true })
    render(<ConnectionDialog />)

    await act(async () => {
      useConnectionStore.setState({ dialogOpen: false })
    })

    expect(closeMock).toHaveBeenCalled()
  })

  it('closes on X button click', async () => {
    const user = userEvent.setup()
    useConnectionStore.setState({ dialogOpen: true })
    render(<ConnectionDialog />)

    const closeBtn = screen.getByLabelText('Close dialog')
    await user.click(closeBtn)

    expect(useConnectionStore.getState().dialogOpen).toBe(false)
  })

  it('renders ConnectionForm inside the dialog', () => {
    useConnectionStore.setState({ dialogOpen: true })
    render(<ConnectionDialog />)

    expect(screen.getByLabelText('Connection Name')).toBeInTheDocument()
    expect(screen.getByLabelText('Host')).toBeInTheDocument()
    expect(screen.getByLabelText('Port')).toBeInTheDocument()
    expect(screen.getByLabelText('Username')).toBeInTheDocument()
  })

  it('renders dialog title with correct aria-labelledby', () => {
    useConnectionStore.setState({ dialogOpen: true })
    render(<ConnectionDialog />)

    const title = screen.getByText('Connection Manager')
    expect(title).toBeInTheDocument()
    expect(title.id).toBe('connection-dialog-title')

    const dialog = title.closest('dialog')
    expect(dialog).toHaveAttribute('aria-labelledby', 'connection-dialog-title')
  })

  it('calls fetchSavedConnections when dialog opens', async () => {
    render(<ConnectionDialog />)

    await act(async () => {
      useConnectionStore.setState({ dialogOpen: true })
    })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('list_connections')
    })
  })

  it('closes on backdrop click', async () => {
    useConnectionStore.setState({ dialogOpen: true })
    const { container } = render(<ConnectionDialog />)

    const dialog = container.querySelector('dialog')!
    // Simulate clicking on the dialog element itself (backdrop area)
    await act(async () => {
      fireEvent.click(dialog)
    })

    expect(useConnectionStore.getState().dialogOpen).toBe(false)
  })

  it('does not close when clicking inside dialog content', async () => {
    const user = userEvent.setup()
    useConnectionStore.setState({ dialogOpen: true })
    render(<ConnectionDialog />)

    // Click on a form field inside the dialog content
    await user.click(screen.getByLabelText('Connection Name'))

    expect(useConnectionStore.getState().dialogOpen).toBe(true)
  })

  it('syncs store on native dialog close event', async () => {
    useConnectionStore.setState({ dialogOpen: true })
    const { container } = render(<ConnectionDialog />)

    const dialog = container.querySelector('dialog')!

    // Simulate native close event (e.g., from Escape key)
    await act(async () => {
      dialog.dispatchEvent(new Event('close'))
    })

    expect(useConnectionStore.getState().dialogOpen).toBe(false)
  })

  describe('SavedConnectionsList integration', () => {
    const testConnection: SavedConnection = {
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
      keepaliveIntervalSecs: 60,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    }

    function mockInvokeForConnections(connections: SavedConnection[]) {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'list_connections') return connections
        if (cmd === 'list_connection_groups') return []
        return undefined
      })
    }

    it('renders SavedConnectionsList in left pane', async () => {
      mockInvokeForConnections([testConnection])

      useConnectionStore.setState({ dialogOpen: true })
      render(<ConnectionDialog />)

      await waitFor(() => {
        expect(screen.getByText('Test DB')).toBeInTheDocument()
      })
      expect(screen.getByTitle('New connection')).toBeInTheDocument()
    })

    it('clicking a saved connection populates the form', async () => {
      const user = userEvent.setup()
      mockInvokeForConnections([testConnection])

      useConnectionStore.setState({ dialogOpen: true })
      render(<ConnectionDialog />)

      await waitFor(() => {
        expect(screen.getByText('Test DB')).toBeInTheDocument()
      })

      // Click the connection in the saved list
      await user.click(screen.getByText('Test DB'))

      // Form should be populated with connection data
      await waitFor(() => {
        expect(screen.getByLabelText('Connection Name')).toHaveValue('Test DB')
        expect(screen.getByLabelText('Host')).toHaveValue('127.0.0.1')
        expect(screen.getByLabelText('Username')).toHaveValue('root')
      })
    })

    it('"+ New" button clears the form for a new connection', async () => {
      const user = userEvent.setup()
      mockInvokeForConnections([testConnection])

      useConnectionStore.setState({ dialogOpen: true })
      render(<ConnectionDialog />)

      await waitFor(() => {
        expect(screen.getByText('Test DB')).toBeInTheDocument()
      })

      // First, select an existing connection to populate form
      await user.click(screen.getByText('Test DB'))

      await waitFor(() => {
        expect(screen.getByLabelText('Connection Name')).toHaveValue('Test DB')
      })

      // Click "+ New" to clear the form
      await user.click(screen.getByTitle('New connection'))

      // Form should be cleared
      await waitFor(() => {
        expect(screen.getByLabelText('Connection Name')).toHaveValue('')
        expect(screen.getByLabelText('Host')).toHaveValue('')
        expect(screen.getByLabelText('Username')).toHaveValue('')
      })
    })
  })
})
