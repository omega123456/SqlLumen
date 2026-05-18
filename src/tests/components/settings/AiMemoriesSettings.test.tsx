import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ipc } from '../../ipc-mock'
import { AiMemoriesSettings } from '../../../components/settings/AiMemoriesSettings'
import { useConnectionStore } from '../../../stores/connection-store'
import type { AiMemory } from '../../../lib/ai-memory-commands'

const mockMemories: Record<string, AiMemory[]> = {
  'conn-1': [
    {
      id: 1,
      connectionId: 'conn-1',
      content: 'Users table has soft deletes',
      createdAt: 1745107200,
      source: 'user',
    },
    {
      id: 2,
      connectionId: 'conn-1',
      content: 'Always use UTC timestamps',
      createdAt: 1745193600,
      source: 'user',
    },
  ],
  'conn-2': [],
}

let deletedIds: number[] = []

let consoleSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  deletedIds = []
  vi.clearAllMocks()
  ipc.override('list_memories', (args) => {
    const connectionId = (args as Record<string, unknown>).connectionId as string
    return mockMemories[connectionId] ?? []
  })
  ipc.override('delete_memory', (args) => {
    const memoryId = (args as Record<string, unknown>).memoryId as number
    deletedIds.push(memoryId)
    return undefined
  })
  useConnectionStore.setState({
    savedConnections: [
      {
        id: 'conn-1',
        name: 'Sample MySQL',
        host: 'localhost',
        port: 3306,
        username: 'root',
        hasPassword: false,
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
        keepaliveIntervalSecs: 60,
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'conn-2',
        name: 'Empty DB',
        host: 'localhost',
        port: 3307,
        username: 'root',
        hasPassword: false,
        defaultDatabase: null,
        sslEnabled: false,
        sslCaPath: null,
        sslCertPath: null,
        sslKeyPath: null,
        color: null,
        groupId: null,
        readOnly: false,
        sortOrder: 1,
        connectTimeoutSecs: 10,
        keepaliveIntervalSecs: 60,
        createdAt: '',
        updatedAt: '',
      },
    ] as never[],
  })
})

afterEach(() => {
  consoleSpy.mockRestore()
})

describe('AiMemoriesSettings', () => {
  it('renders the section title "Memories"', async () => {
    render(<AiMemoriesSettings />)
    await waitFor(() => {
      expect(screen.getByText('Memories')).toBeInTheDocument()
    })
  })

  it('shows empty state when no memories exist', async () => {
    // Override to return empty for all connections
    ipc.override('list_memories', () => [])

    render(<AiMemoriesSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('ai-memories-empty-state')).toBeInTheDocument()
    })
    expect(screen.getByText(/No memories saved yet/)).toBeInTheDocument()
  })

  it('shows connection accordion when memories exist', async () => {
    render(<AiMemoriesSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('ai-memories-connection-conn-1')).toBeInTheDocument()
    })
    expect(screen.getByText(/Sample MySQL/)).toBeInTheDocument()
    expect(screen.getByText(/2 memories/)).toBeInTheDocument()
    // conn-2 has no memories, should not appear
    expect(screen.queryByTestId('ai-memories-connection-conn-2')).not.toBeInTheDocument()
  })

  it('memory item shows content and date when expanded', async () => {
    const user = userEvent.setup()
    render(<AiMemoriesSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('ai-memories-connection-conn-1')).toBeInTheDocument()
    })

    // Click to expand
    await user.click(screen.getByText(/Sample MySQL/))

    expect(screen.getByTestId('ai-memory-item-1')).toBeInTheDocument()
    expect(screen.getByText('Users table has soft deletes')).toBeInTheDocument()
    expect(screen.getAllByText(/Saved/).length).toBeGreaterThan(0)
  })

  it('clicking delete button opens confirm dialog', async () => {
    const user = userEvent.setup()
    render(<AiMemoriesSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('ai-memories-connection-conn-1')).toBeInTheDocument()
    })

    await user.click(screen.getByText(/Sample MySQL/))
    await user.click(screen.getByTestId('ai-memory-delete-1'))

    expect(screen.getByText('Delete Memory')).toBeInTheDocument()
    expect(screen.getByText('Are you sure you want to delete this memory?')).toBeInTheDocument()
  })

  it('after confirming delete, calls deleteMemory IPC and removes item', async () => {
    const user = userEvent.setup()
    render(<AiMemoriesSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('ai-memories-connection-conn-1')).toBeInTheDocument()
    })

    await user.click(screen.getByText(/Sample MySQL/))
    await user.click(screen.getByTestId('ai-memory-delete-1'))

    // Confirm deletion - find the confirm button in the dialog
    const dialogBtns = screen.getAllByRole('button', { name: 'Delete' })
    const confirmDialogBtn =
      dialogBtns.find((btn) => btn.closest('[role="dialog"]') !== null) ??
      dialogBtns[dialogBtns.length - 1]
    await user.click(confirmDialogBtn)

    await waitFor(() => {
      expect(deletedIds).toContain(1)
    })

    // Item should be removed
    await waitFor(() => {
      expect(screen.queryByTestId('ai-memory-item-1')).not.toBeInTheDocument()
    })
  })
})
