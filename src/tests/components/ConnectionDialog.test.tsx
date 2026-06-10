import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConnectionDialog } from '../../components/connection-dialog/ConnectionDialog'
import { useConnectionStore } from '../../stores/connection-store'
import { ipc } from '../ipc-mock'
import type { SavedConnection } from '../../types/connection'

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

  it('renders ConnectionForm inside the dialog', async () => {
    useConnectionStore.setState({ dialogOpen: true })
    await act(async () => {
      render(<ConnectionDialog />)
      await Promise.resolve()
    })

    expect(screen.getByLabelText('Connection name')).toBeInTheDocument()
    expect(screen.getByLabelText('Host address')).toBeInTheDocument()
    expect(screen.getByLabelText('Port')).toBeInTheDocument()
    expect(screen.getByLabelText('Username')).toBeInTheDocument()
  })

  it('renders dialog title with correct aria-labelledby', async () => {
    useConnectionStore.setState({ dialogOpen: true })
    await act(async () => {
      render(<ConnectionDialog />)
      await Promise.resolve()
    })

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
      expect(ipc.calls('list_connections')).toHaveLength(1)
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
    await user.click(screen.getByLabelText('Connection name'))

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

    it('renders SavedConnectionsList in left pane', async () => {
      ipc.override('list_connections', () => [testConnection])

      useConnectionStore.setState({ dialogOpen: true })
      render(<ConnectionDialog />)

      await waitFor(() => {
        expect(screen.getByText('Test DB')).toBeInTheDocument()
      })
      expect(screen.getByTitle('New connection')).toBeInTheDocument()
    })

    it('clicking a saved connection populates the form', async () => {
      const user = userEvent.setup()
      ipc.override('list_connections', () => [testConnection])

      useConnectionStore.setState({ dialogOpen: true })
      render(<ConnectionDialog />)

      await waitFor(() => {
        expect(screen.getByText('Test DB')).toBeInTheDocument()
      })

      // Click the connection in the saved list
      await user.click(screen.getByText('Test DB'))

      // Form should be populated with connection data
      await waitFor(() => {
        expect(screen.getByLabelText('Connection name')).toHaveValue('Test DB')
        expect(screen.getByLabelText('Host address')).toHaveValue('127.0.0.1')
        expect(screen.getByLabelText('Username')).toHaveValue('root')
      })
    })

    it('"+ New" button clears the form for a new connection', async () => {
      const user = userEvent.setup()
      ipc.override('list_connections', () => [testConnection])

      useConnectionStore.setState({ dialogOpen: true })
      render(<ConnectionDialog />)

      await waitFor(() => {
        expect(screen.getByText('Test DB')).toBeInTheDocument()
      })

      // First, select an existing connection to populate form
      await user.click(screen.getByText('Test DB'))

      await waitFor(() => {
        expect(screen.getByLabelText('Connection name')).toHaveValue('Test DB')
      })

      // Click "+ New" to clear the form
      await user.click(screen.getByTitle('New connection'))

      // Form should be cleared
      await waitFor(() => {
        expect(screen.getByLabelText('Connection name')).toHaveValue('')
        expect(screen.getByLabelText('Host address')).toHaveValue('')
        expect(screen.getByLabelText('Username')).toHaveValue('')
      })
    })

    it('hover duplicate button seeds the form with "Copy of" data and empty password', async () => {
      const user = userEvent.setup()
      ipc.override('list_connections', () => [testConnection])

      useConnectionStore.setState({ dialogOpen: true })
      render(<ConnectionDialog />)

      await waitFor(() => {
        expect(screen.getByText('Test DB')).toBeInTheDocument()
      })

      await user.click(screen.getByLabelText('Duplicate Test DB'))

      await waitFor(() => {
        expect(screen.getByLabelText('Connection name')).toHaveValue('Copy of Test DB')
      })
      expect(screen.getByLabelText('Host address')).toHaveValue('127.0.0.1')
      expect(screen.getByLabelText('Username')).toHaveValue('root')
      expect(screen.getByLabelText('Password')).toHaveValue('')
      expect(screen.getByLabelText('Default Database')).toHaveValue('mydb')
      // Source had a password — the not-copied hint is shown
      expect(screen.getByTestId('duplicate-password-hint')).toBeInTheDocument()
      // Unsaved duplicate — no Delete button
      expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    })

    it('context menu Duplicate seeds the form as a new unsaved connection', async () => {
      const user = userEvent.setup()
      ipc.override('list_connections', () => [testConnection])
      ipc.override('save_connection', () => 'dup-id')

      useConnectionStore.setState({ dialogOpen: true })
      render(<ConnectionDialog />)

      await waitFor(() => {
        expect(screen.getByText('Test DB')).toBeInTheDocument()
      })

      fireEvent.contextMenu(screen.getByText('Test DB'))
      await user.click(await screen.findByRole('menuitem', { name: 'Duplicate' }))

      await waitFor(() => {
        expect(screen.getByLabelText('Connection name')).toHaveValue('Copy of Test DB')
      })

      // Saving the duplicate creates a new connection (save, not update)
      await user.click(screen.getByText('Save'))
      await waitFor(() => {
        expect(ipc.calls('save_connection')).toHaveLength(1)
      })
      expect(ipc.calls('update_connection')).toHaveLength(0)
    })

    it('selecting another connection clears the duplicate seed', async () => {
      const user = userEvent.setup()
      ipc.override('list_connections', () => [testConnection])

      useConnectionStore.setState({ dialogOpen: true })
      render(<ConnectionDialog />)

      await waitFor(() => {
        expect(screen.getByText('Test DB')).toBeInTheDocument()
      })

      await user.click(screen.getByLabelText('Duplicate Test DB'))
      await waitFor(() => {
        expect(screen.getByLabelText('Connection name')).toHaveValue('Copy of Test DB')
      })

      await user.click(screen.getByText('Test DB'))
      await waitFor(() => {
        expect(screen.getByLabelText('Connection name')).toHaveValue('Test DB')
      })

      // "+ New" yields an empty form, not the duplicate seed
      await user.click(screen.getByTitle('New connection'))
      await waitFor(() => {
        expect(screen.getByLabelText('Connection name')).toHaveValue('')
      })
    })

    it('renders the delete confirmation dialog inside the connection modal top layer', async () => {
      const user = userEvent.setup()
      ipc.override('list_connections', () => [testConnection])

      useConnectionStore.setState({ dialogOpen: true })
      const { container } = render(<ConnectionDialog />)

      await waitFor(() => {
        expect(screen.getByText('Test DB')).toBeInTheDocument()
      })

      await user.click(screen.getByText('Test DB'))
      await user.click(screen.getByRole('button', { name: 'Delete' }))

      const confirmDialog = await screen.findByTestId('confirm-dialog')
      const nativeDialog = container.querySelector('dialog')

      expect(nativeDialog?.contains(confirmDialog)).toBe(true)
    })
  })
})
