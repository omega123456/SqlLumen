import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SavedConnectionsList } from '../../components/connection-dialog/SavedConnectionsList'
import { useConnectionStore } from '../../stores/connection-store'
import type { SavedConnection, ConnectionGroup } from '../../types/connection'

// Mock IPC
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}))

import { invoke } from '@tauri-apps/api/core'
const mockInvoke = vi.mocked(invoke)

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
  onDeleteConnection: vi.fn(),
  selectedConnectionId: null,
}

beforeEach(() => {
  mockInvoke.mockReset()
  // Default mock: list commands return empty arrays, others return undefined
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'list_connections') return []
    if (cmd === 'list_connection_groups') return []
    return undefined
  })
  defaultProps.onSelectConnection.mockClear()
  defaultProps.onNewConnection.mockClear()
  defaultProps.onDeleteConnection.mockClear()

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
      expect(dot).toHaveStyle({ backgroundColor: 'var(--color-text-muted)' })
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
        container.querySelectorAll('[class*="connectionName"]')
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

  describe('context menu — connection', () => {
    it('shows context menu with Delete on right-click', async () => {
      const conn = makeConnection({ id: 'c1', name: 'Right Click Me' })

      useConnectionStore.setState({
        savedConnections: [conn],
        connectionGroups: [],
      })

      render(<SavedConnectionsList {...defaultProps} />)

      const item = screen.getByText('Right Click Me')
      fireEvent.contextMenu(item, { clientX: 100, clientY: 200 })

      expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
    })

    it('deletes connection after confirmation', async () => {
      const user = userEvent.setup()
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

      const conn = makeConnection({ id: 'c1', name: 'Delete Me' })

      useConnectionStore.setState({
        savedConnections: [conn],
        connectionGroups: [],
      })

      render(<SavedConnectionsList {...defaultProps} />)

      const item = screen.getByText('Delete Me')
      fireEvent.contextMenu(item, { clientX: 100, clientY: 200 })

      const deleteBtn = screen.getByRole('menuitem', { name: 'Delete' })
      await user.click(deleteBtn)

      expect(confirmSpy).toHaveBeenCalledWith('Are you sure you want to delete this connection?')
      expect(mockInvoke).toHaveBeenCalledWith('delete_connection', { id: 'c1' })

      await waitFor(() => {
        expect(defaultProps.onDeleteConnection).toHaveBeenCalledWith('c1')
      })

      confirmSpy.mockRestore()
    })

    it('does not delete connection when confirmation is cancelled', async () => {
      const user = userEvent.setup()
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)

      const conn = makeConnection({ id: 'c1', name: 'Keep Me' })

      useConnectionStore.setState({
        savedConnections: [conn],
        connectionGroups: [],
      })

      render(<SavedConnectionsList {...defaultProps} />)

      fireEvent.contextMenu(screen.getByText('Keep Me'), { clientX: 100, clientY: 200 })
      const deleteBtn = screen.getByRole('menuitem', { name: 'Delete' })
      await user.click(deleteBtn)

      expect(confirmSpy).toHaveBeenCalled()
      expect(mockInvoke).not.toHaveBeenCalledWith('delete_connection', expect.anything())

      confirmSpy.mockRestore()
    })

    it('dismisses context menu on Escape key', () => {
      const conn = makeConnection({ id: 'c1', name: 'Escape Me' })

      useConnectionStore.setState({
        savedConnections: [conn],
        connectionGroups: [],
      })

      render(<SavedConnectionsList {...defaultProps} />)

      fireEvent.contextMenu(screen.getByText('Escape Me'), { clientX: 100, clientY: 200 })
      expect(screen.getByRole('menu')).toBeInTheDocument()

      fireEvent.keyDown(document, { key: 'Escape' })
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('dismisses context menu on outside click', () => {
      const conn = makeConnection({ id: 'c1', name: 'Outside Click' })

      useConnectionStore.setState({
        savedConnections: [conn],
        connectionGroups: [],
      })

      render(<SavedConnectionsList {...defaultProps} />)

      fireEvent.contextMenu(screen.getByText('Outside Click'), { clientX: 100, clientY: 200 })
      expect(screen.getByRole('menu')).toBeInTheDocument()

      fireEvent.mouseDown(document)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
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

      expect(mockInvoke).toHaveBeenCalledWith('update_connection_group', {
        id: 'grp-1',
        name: 'NewName',
      })
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
        expect(mockInvoke).toHaveBeenCalledWith('update_connection_group', {
          id: 'grp-1',
          name: 'BlurName',
        })
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
      expect(mockInvoke).toHaveBeenCalledWith('delete_connection_group', { id: 'grp-1' })

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

      expect(mockInvoke).toHaveBeenCalledWith('create_connection_group', {
        name: 'My New Group',
      })
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
      expect(mockInvoke).not.toHaveBeenCalledWith('create_connection_group', expect.anything())
    })

    it('cancels new group on Escape key', async () => {
      const user = userEvent.setup()

      render(<SavedConnectionsList {...defaultProps} />)

      await user.click(screen.getByTitle('New group'))

      const input = screen.getByLabelText('New group name')
      await user.type(input, 'discard me')
      await user.keyboard('{Escape}')
      expect(mockInvoke).not.toHaveBeenCalledWith('create_connection_group', expect.anything())
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
    it('displays error when delete connection fails', async () => {
      const user = userEvent.setup()
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'delete_connection') throw new Error('Network error')
        if (cmd === 'list_connections') return []
        if (cmd === 'list_connection_groups') return []
        return undefined
      })

      const conn = makeConnection({ id: 'c1', name: 'Fail Delete' })
      useConnectionStore.setState({
        savedConnections: [conn],
        connectionGroups: [],
      })

      render(<SavedConnectionsList {...defaultProps} />)

      fireEvent.contextMenu(screen.getByText('Fail Delete'), { clientX: 100, clientY: 200 })
      await user.click(screen.getByRole('menuitem', { name: 'Delete' }))

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument()
        expect(screen.getByText('Network error')).toBeInTheDocument()
      })

      confirmSpy.mockRestore()
    })

    it('error can be dismissed', async () => {
      const user = userEvent.setup()
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'delete_connection') throw new Error('Delete failed')
        if (cmd === 'list_connections') return []
        if (cmd === 'list_connection_groups') return []
        return undefined
      })

      const conn = makeConnection({ id: 'c1', name: 'Error DB' })
      useConnectionStore.setState({
        savedConnections: [conn],
        connectionGroups: [],
      })

      render(<SavedConnectionsList {...defaultProps} />)

      fireEvent.contextMenu(screen.getByText('Error DB'), { clientX: 100, clientY: 200 })
      await user.click(screen.getByRole('menuitem', { name: 'Delete' }))

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument()
      })

      await user.click(screen.getByLabelText('Dismiss error'))

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()

      confirmSpy.mockRestore()
    })
  })
})
