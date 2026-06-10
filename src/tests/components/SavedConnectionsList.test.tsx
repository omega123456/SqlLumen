import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SavedConnectionsList } from '../../components/connection-dialog/SavedConnectionsList'
import { useConnectionStore } from '../../stores/connection-store'
import { ipc } from '../ipc-mock'
import type { SavedConnection, ConnectionGroup } from '../../types/connection'

function makeConnection(overrides: Partial<SavedConnection> = {}): SavedConnection {
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
    color: '#3b82f6',
    groupId: null,
    readOnly: false,
    sortOrder: 0,
    connectTimeoutSecs: 10,
    keepaliveIntervalSecs: 60,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeGroup(overrides: Partial<ConnectionGroup> = {}): ConnectionGroup {
  return {
    id: 'grp-1',
    name: 'Production',
    parentId: null,
    sortOrder: 0,
    createdAt: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

const defaultProps = {
  onSelectConnection: vi.fn(),
  onNewConnection: vi.fn(),
  onDuplicateConnection: vi.fn(),
  selectedConnectionId: null,
}

beforeEach(() => {
  defaultProps.onSelectConnection.mockClear()
  defaultProps.onNewConnection.mockClear()
  defaultProps.onDuplicateConnection.mockClear()

  useConnectionStore.setState({
    savedConnections: [],
    connectionGroups: [],
    activeConnections: {},
    activeTabId: null,
    dialogOpen: false,
    error: null,
  })
})

describe('SavedConnectionsList', () => {
  describe('rendering', () => {
    it('renders connections grouped by their group', () => {
      const group = makeGroup({ id: 'grp-1', name: 'Production' })
      const conn1 = makeConnection({ id: 'c1', name: 'Prod DB', groupId: 'grp-1' })
      const conn2 = makeConnection({ id: 'c2', name: 'Dev DB', groupId: null })

      useConnectionStore.setState({
        savedConnections: [conn1, conn2],
        connectionGroups: [group],
      })

      render(<SavedConnectionsList {...defaultProps} />)

      expect(screen.getByText('Production')).toBeInTheDocument()
      expect(screen.getByText('Prod DB')).toBeInTheDocument()
      expect(screen.getByText('Ungrouped')).toBeInTheDocument()
      expect(screen.getByText('Dev DB')).toBeInTheDocument()
    })

    it('renders "Ungrouped" section for connections without groupId', () => {
      const conn1 = makeConnection({ id: 'c1', name: 'My DB', groupId: null })
      const conn2 = makeConnection({ id: 'c2', name: 'Another DB', groupId: null })

      useConnectionStore.setState({
        savedConnections: [conn1, conn2],
        connectionGroups: [],
      })

      render(<SavedConnectionsList {...defaultProps} />)

      expect(screen.getByText('Ungrouped')).toBeInTheDocument()
      expect(screen.getByText('My DB')).toBeInTheDocument()
      expect(screen.getByText('Another DB')).toBeInTheDocument()
    })

    it('does not render "Ungrouped" section when all connections are grouped', () => {
      const group = makeGroup({ id: 'grp-1', name: 'Dev' })
      const conn = makeConnection({ id: 'c1', name: 'Dev DB', groupId: 'grp-1' })

      useConnectionStore.setState({
        savedConnections: [conn],
        connectionGroups: [group],
      })

      render(<SavedConnectionsList {...defaultProps} />)

      expect(screen.getByText('Dev')).toBeInTheDocument()
      expect(screen.queryByText('Ungrouped')).not.toBeInTheDocument()
    })

    it('renders color dot with connection color', () => {
      const conn = makeConnection({ id: 'c1', name: 'Colored DB', color: '#ff0000' })

      useConnectionStore.setState({
        savedConnections: [conn],
        connectionGroups: [],
      })

      const { container } = render(<SavedConnectionsList {...defaultProps} />)

      const dot = container.querySelector('[class*="colorDot"]')
      expect(dot).toHaveStyle({ backgroundColor: '#ff0000' })
    })

    it('renders color dot with muted color when connection color is null', () => {
      const conn = makeConnection({ id: 'c1', name: 'No Color DB', color: null })

      useConnectionStore.setState({
        savedConnections: [conn],
        connectionGroups: [],
      })

      const { container } = render(<SavedConnectionsList {...defaultProps} />)

      const dot = container.querySelector('[class*="colorDot"]')
      expect(dot).toHaveStyle({ backgroundColor: 'var(--on-surface-variant)' })
    })

    it('sorts connections within groups by name', () => {
      const group = makeGroup({ id: 'grp-1', name: 'Servers' })
      const connB = makeConnection({ id: 'c1', name: 'Bravo', groupId: 'grp-1' })
      const connA = makeConnection({ id: 'c2', name: 'Alpha', groupId: 'grp-1' })
      const connC = makeConnection({ id: 'c3', name: 'Charlie', groupId: 'grp-1' })

      useConnectionStore.setState({
        savedConnections: [connB, connA, connC],
        connectionGroups: [group],
      })

      const { container } = render(<SavedConnectionsList {...defaultProps} />)

      const connectionNames = Array.from(
        container.querySelectorAll('[class*="connectionTitle"]')
      ).map((el) => el.textContent)

      expect(connectionNames).toEqual(['Alpha', 'Bravo', 'Charlie'])
    })

    it('sorts groups by sortOrder', () => {
      const group1 = makeGroup({ id: 'grp-1', name: 'Second', sortOrder: 2 })
      const group2 = makeGroup({ id: 'grp-2', name: 'First', sortOrder: 1 })

      useConnectionStore.setState({
        savedConnections: [],
        connectionGroups: [group1, group2],
      })

      const { container } = render(<SavedConnectionsList {...defaultProps} />)

      const groupNames = Array.from(container.querySelectorAll('[class*="groupName"]')).map(
        (el) => el.textContent
      )

      expect(groupNames).toEqual(['First', 'Second'])
    })
  })

  describe('selection', () => {
    it('calls onSelectConnection when clicking a connection', async () => {
      const user = userEvent.setup()
      const conn = makeConnection({ id: 'c1', name: 'Click Me' })

      useConnectionStore.setState({
        savedConnections: [conn],
        connectionGroups: [],
      })

      render(<SavedConnectionsList {...defaultProps} />)

      await user.click(screen.getByText('Click Me'))
      expect(defaultProps.onSelectConnection).toHaveBeenCalledWith(conn)
    })

    it('highlights the selected connection', () => {
      const conn = makeConnection({ id: 'c1', name: 'Selected DB' })

      useConnectionStore.setState({
        savedConnections: [conn],
        connectionGroups: [],
      })

      const { container } = render(
        <SavedConnectionsList {...defaultProps} selectedConnectionId="c1" />
      )

      const item = container.querySelector('[class*="connectionItemSelected"]')
      expect(item).toBeInTheDocument()
      expect(item).toHaveTextContent('Selected DB')
    })

    it('does not highlight unselected connections', () => {
      const conn = makeConnection({ id: 'c1', name: 'Not Selected' })

      useConnectionStore.setState({
        savedConnections: [conn],
        connectionGroups: [],
      })

      const { container } = render(<SavedConnectionsList {...defaultProps} />)

      const selectedItem = container.querySelector('[class*="connectionItemSelected"]')
      expect(selectedItem).not.toBeInTheDocument()
    })
  })

  describe('connection interactions', () => {
    it('right-clicking a saved connection opens a context menu with Duplicate', async () => {
      const user = userEvent.setup()
      const conn = makeConnection({ id: 'c1', name: 'Right Click Me' })

      useConnectionStore.setState({
        savedConnections: [conn],
        connectionGroups: [],
      })

      render(<SavedConnectionsList {...defaultProps} />)

      fireEvent.contextMenu(screen.getByText('Right Click Me'), { clientX: 100, clientY: 200 })

      const duplicateItem = await screen.findByRole('menuitem', { name: 'Duplicate' })
      await user.click(duplicateItem)

      expect(defaultProps.onDuplicateConnection).toHaveBeenCalledWith(conn)
      expect(screen.queryByTestId('saved-connections-context-menu')).not.toBeInTheDocument()
    })

    it('hover duplicate button calls onDuplicateConnection without selecting', async () => {
      const user = userEvent.setup()
      const conn = makeConnection({ id: 'c1', name: 'Dup Me' })

      useConnectionStore.setState({
        savedConnections: [conn],
        connectionGroups: [],
      })

      render(<SavedConnectionsList {...defaultProps} />)

      await user.click(screen.getByLabelText('Duplicate Dup Me'))

      expect(defaultProps.onDuplicateConnection).toHaveBeenCalledWith(conn)
      expect(defaultProps.onSelectConnection).not.toHaveBeenCalled()
    })
  })

  describe('context menu — group', () => {
    it('shows context menu with Rename and Delete on group right-click', () => {
      const group = makeGroup({ id: 'grp-1', name: 'Production' })

      useConnectionStore.setState({
        savedConnections: [],
        connectionGroups: [group],
      })

      render(<SavedConnectionsList {...defaultProps} />)

      fireEvent.contextMenu(screen.getByText('Production'), { clientX: 100, clientY: 200 })

      expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
    })

    it('does not open group context menu when right-clicking the rename input', async () => {
      const user = userEvent.setup()
      const group = makeGroup({ id: 'grp-1', name: 'OldName' })

      useConnectionStore.setState({
        savedConnections: [],
        connectionGroups: [group],
      })

      render(<SavedConnectionsList {...defaultProps} />)

      fireEvent.contextMenu(screen.getByText('OldName'), { clientX: 100, clientY: 200 })
      await user.click(screen.getByRole('menuitem', { name: 'Rename' }))

      const renameInput = screen.getByLabelText('Group name')
      fireEvent.contextMenu(renameInput, { clientX: 50, clientY: 50 })

      expect(screen.queryByRole('menuitem', { name: 'Rename' })).not.toBeInTheDocument()
      expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument()
    })

    it('renames a group via inline input on Enter', async () => {
      const user = userEvent.setup()

      const group = makeGroup({ id: 'grp-1', name: 'OldName' })

      useConnectionStore.setState({
        savedConnections: [],
        connectionGroups: [group],
      })

      render(<SavedConnectionsList {...defaultProps} />)

      fireEvent.contextMenu(screen.getByText('OldName'), { clientX: 100, clientY: 200 })
      await user.click(screen.getByRole('menuitem', { name: 'Rename' }))

      const renameInput = screen.getByLabelText('Group name')
      expect(renameInput).toBeInTheDocument()
      expect(renameInput).toHaveValue('OldName')

      await user.clear(renameInput)
      await user.type(renameInput, 'NewName{Enter}')

      const calls = ipc.calls('update_connection_group')
      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatchObject({ id: 'grp-1', name: 'NewName' })
    })

    it('renames a group on blur', async () => {
      const user = userEvent.setup()

      const group = makeGroup({ id: 'grp-1', name: 'BlurRename' })

      useConnectionStore.setState({
        savedConnections: [],
        connectionGroups: [group],
      })

      render(<SavedConnectionsList {...defaultProps} />)

      fireEvent.contextMenu(screen.getByText('BlurRename'), { clientX: 100, clientY: 200 })
      await user.click(screen.getByRole('menuitem', { name: 'Rename' }))

      const renameInput = screen.getByLabelText('Group name')
      await user.clear(renameInput)
      await user.type(renameInput, 'BlurName')

      // Blur the input by clicking elsewhere
      await user.click(document.body)

      await waitFor(() => {
        const calls = ipc.calls('update_connection_group')
        expect(calls).toHaveLength(1)
        expect(calls[0]).toMatchObject({ id: 'grp-1', name: 'BlurName' })
      })
    })

    it('deletes a group after confirmation', async () => {
      const user = userEvent.setup()
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

      const group = makeGroup({ id: 'grp-1', name: 'DeleteGroup' })

      useConnectionStore.setState({
        savedConnections: [],
        connectionGroups: [group],
      })

      render(<SavedConnectionsList {...defaultProps} />)

      fireEvent.contextMenu(screen.getByText('DeleteGroup'), { clientX: 100, clientY: 200 })
      await user.click(screen.getByRole('menuitem', { name: 'Delete' }))

      expect(confirmSpy).toHaveBeenCalledWith(
        'Are you sure you want to delete this group? Connections will be moved to ungrouped.'
      )
      expect(ipc.calls('delete_connection_group')).toHaveLength(1)

      confirmSpy.mockRestore()
    })
  })

  describe('New connection button', () => {
    it('calls onNewConnection when "+ New" button is clicked', async () => {
      const user = userEvent.setup()

      render(<SavedConnectionsList {...defaultProps} />)

      await user.click(screen.getByTitle('New connection'))
      expect(defaultProps.onNewConnection).toHaveBeenCalledTimes(1)
    })
  })

  describe('New group button', () => {
    it('shows inline input when "+ Grp" button is clicked', async () => {
      const user = userEvent.setup()

      render(<SavedConnectionsList {...defaultProps} />)

      await user.click(screen.getByTitle('New group'))

      expect(screen.getByLabelText('New group name')).toBeInTheDocument()
    })

    it('creates a group when name is entered and Enter pressed', async () => {
      const user = userEvent.setup()

      render(<SavedConnectionsList {...defaultProps} />)

      await user.click(screen.getByTitle('New group'))

      const input = screen.getByLabelText('New group name')
      await user.type(input, 'My New Group{Enter}')

      const calls = ipc.calls('create_connection_group')
      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatchObject({ name: 'My New Group' })
    })

    it('discards new group when name is empty on blur', async () => {
      const user = userEvent.setup()

      render(<SavedConnectionsList {...defaultProps} />)

      await user.click(screen.getByTitle('New group'))

      const input = screen.getByLabelText('New group name')
      // Verify input exists
      expect(input).toBeInTheDocument()
      // Blur with empty name
      await user.click(document.body)

      await waitFor(() => {
        expect(screen.queryByLabelText('New group name')).not.toBeInTheDocument()
      })
      expect(ipc.calls('create_connection_group')).toHaveLength(0)
    })

    it('cancels new group on Escape key', async () => {
      const user = userEvent.setup()

      render(<SavedConnectionsList {...defaultProps} />)

      await user.click(screen.getByTitle('New group'))

      const input = screen.getByLabelText('New group name')
      await user.type(input, 'discard me')
      await user.keyboard('{Escape}')
      expect(ipc.calls('create_connection_group')).toHaveLength(0)
    })
  })

  describe('connections with missing group', () => {
    it('treats connections with nonexistent groupId as ungrouped', () => {
      const conn = makeConnection({
        id: 'c1',
        name: 'Orphaned DB',
        groupId: 'nonexistent-group',
      })

      useConnectionStore.setState({
        savedConnections: [conn],
        connectionGroups: [],
      })

      render(<SavedConnectionsList {...defaultProps} />)

      expect(screen.getByText('Ungrouped')).toBeInTheDocument()
      expect(screen.getByText('Orphaned DB')).toBeInTheDocument()
    })
  })

  describe('error handling', () => {
    it('error can be dismissed', async () => {
      const user = userEvent.setup()
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
      ipc.override('delete_connection_group', () => {
        throw new Error('Delete failed')
      })

      const group = makeGroup({ id: 'grp-1', name: 'Error Group' })
      useConnectionStore.setState({
        savedConnections: [],
        connectionGroups: [group],
      })

      render(<SavedConnectionsList {...defaultProps} />)

      fireEvent.contextMenu(screen.getByText('Error Group'), { clientX: 100, clientY: 200 })
      await user.click(screen.getByRole('menuitem', { name: 'Delete' }))

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument()
        expect(screen.getByText('Delete failed')).toBeInTheDocument()
      })

      await user.click(screen.getByLabelText('Dismiss error'))

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()

      confirmSpy.mockRestore()
    })
  })
})
