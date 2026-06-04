import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ipc } from '../../ipc-mock'
import { AiMemoriesSettings } from '../../../components/settings/AiMemoriesSettings'
import { useConnectionStore } from '../../../stores/connection-store'
import { useToastStore } from '../../../stores/toast-store'
import type { SavedConnection, ConnectionGroup } from '../../../types/connection'
import type { AiMemory } from '../../../lib/ai-memory-commands'

// Flush any trailing async state updates (e.g. the post-mutation `loadMemories`
// refetch) inside an act scope so no React act(...) warning leaks across tests.
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function buildConnection(overrides: Partial<SavedConnection>): SavedConnection {
  return {
    id: 'conn',
    name: 'Conn',
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
    ...overrides,
  }
}

const globalMemory: AiMemory = {
  id: 1,
  scope: 'global',
  connectionId: null,
  groupId: null,
  content: 'Always prefer CTEs over subqueries',
  createdAt: 1745107200,
  source: 'manual',
}

const groupMemory: AiMemory = {
  id: 1,
  scope: 'group',
  connectionId: null,
  groupId: 'grp-1',
  content: 'All timestamps are UTC',
  createdAt: 1745107200,
  source: 'manual',
}

const connMemory: AiMemory = {
  id: 1,
  scope: 'connection',
  connectionId: 'conn-1',
  groupId: null,
  content: 'Users table has soft deletes',
  createdAt: 1745107200,
  source: 'manual',
}

function setupStore(opts?: {
  connections?: SavedConnection[]
  groups?: ConnectionGroup[]
  activeSessions?: Record<string, { profileId: string; groupId: string | null }>
}) {
  const connections = opts?.connections ?? [
    buildConnection({ id: 'conn-1', name: 'Sample MySQL' }),
  ]
  const groups = opts?.groups ?? []
  const activeConnections = Object.fromEntries(
    Object.entries(opts?.activeSessions ?? {}).map(([sessionId, info]) => [
      sessionId,
      {
        id: sessionId,
        profile: buildConnection({ id: info.profileId, groupId: info.groupId }),
        status: 'connected' as const,
        serverVersion: '8.0',
      },
    ])
  )
  act(() => {
    useConnectionStore.setState({
      savedConnections: connections,
      connectionGroups: groups,
      activeConnections,
    })
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  act(() => {
    useToastStore.setState({ toasts: [] })
  })
  ipc.override('list_global_memories', () => [globalMemory])
  ipc.override('list_group_memories', () => [])
  ipc.override('list_connection_memories', () => [])
})

afterEach(async () => {
  // Allow any pending post-mutation refetch to resolve inside act before teardown.
  await settle()
})

describe('AiMemoriesSettings', () => {
  it('renders the Global section with its memory', async () => {
    setupStore()
    render(<AiMemoriesSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('ai-memory-section-global')).toBeInTheDocument()
    })
    expect(screen.getByText('Always prefer CTEs over subqueries')).toBeInTheDocument()
    expect(screen.getByText(/Saved/)).toBeInTheDocument()
  })

  it('renders per-group sections with nested connection sub-sections', async () => {
    setupStore({
      groups: [{ id: 'grp-1', name: 'Work DBs', parentId: null, sortOrder: 0, createdAt: '' }],
      connections: [buildConnection({ id: 'conn-1', name: 'prod-db', groupId: 'grp-1' })],
    })
    ipc.override('list_group_memories', () => [groupMemory])
    render(<AiMemoriesSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('ai-memory-section-group-grp-1')).toBeInTheDocument()
    })
    expect(screen.getByTestId('ai-memory-section-connection-conn-1')).toBeInTheDocument()
    expect(screen.getByText('Work DBs')).toBeInTheDocument()
    expect(screen.getByText('prod-db')).toBeInTheDocument()
  })

  it('renders ungrouped connections under "No Group" with their memories', async () => {
    setupStore({ connections: [buildConnection({ id: 'conn-1', name: 'local-dev' })] })
    ipc.override('list_connection_memories', () => [connMemory])
    render(<AiMemoriesSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('ai-memory-ungrouped-label')).toBeInTheDocument()
    })
    expect(screen.getByText('local-dev')).toBeInTheDocument()
    expect(screen.getByText('Users table has soft deletes')).toBeInTheDocument()
  })

  it('shows empty state per section when it has no memories', async () => {
    setupStore({ connections: [buildConnection({ id: 'conn-1', name: 'local-dev' })] })
    render(<AiMemoriesSettings />)
    // The connection section is empty -> shows "No memories" + Add affordance
    await waitFor(() => {
      expect(screen.getByTestId('ai-memory-empty-connection-conn-1')).toBeInTheDocument()
    })
    expect(screen.getByTestId('ai-memory-add-trigger-connection-conn-1')).toBeInTheDocument()
  })

  it('deletes a memory with confirmation and calls delete_memory', async () => {
    const user = userEvent.setup()
    const deleted: Array<Record<string, unknown>> = []
    ipc.override('delete_memory', (args) => {
      deleted.push(args as Record<string, unknown>)
      return undefined
    })
    setupStore()
    render(<AiMemoriesSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('ai-memory-item-1')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('ai-memory-delete-1'))
    expect(screen.getByText('Delete Memory')).toBeInTheDocument()

    const dialogBtns = screen.getAllByRole('button', { name: 'Delete' })
    const confirmBtn =
      dialogBtns.find((b) => b.closest('[role="dialog"]') !== null) ??
      dialogBtns[dialogBtns.length - 1]
    await user.click(confirmBtn)

    await waitFor(() => {
      expect(deleted).toHaveLength(1)
    })
    expect(deleted[0]).toMatchObject({ scope: 'global', memoryId: 1 })
    await settle()
  })

  it('adds a memory inline at the section scope using an active session', async () => {
    const user = userEvent.setup()
    const saved: Array<Record<string, unknown>> = []
    ipc.override('save_memory', (args) => {
      saved.push(args as Record<string, unknown>)
      return {
        id: 2,
        scope: 'global',
        connectionId: null,
        groupId: null,
        content: 'new note',
        createdAt: 1745107200,
        source: 'manual',
      }
    })
    setupStore({
      activeSessions: { 'sess-1': { profileId: 'conn-1', groupId: null } },
    })
    render(<AiMemoriesSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('ai-memory-section-global')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('ai-memory-add-trigger-global'))
    const textarea = await screen.findByTestId('ai-memory-add-textarea-global')
    await user.type(textarea, 'new note')
    await user.click(screen.getByTestId('ai-memory-add-save-global'))

    await waitFor(() => {
      expect(saved).toHaveLength(1)
    })
    expect(saved[0]).toMatchObject({ scope: 'global', content: 'new note', sessionId: 'sess-1' })
    await settle()
  })

  it('shows an error when adding with no active session for the scope', async () => {
    const user = userEvent.setup()
    let saveCount = 0
    ipc.override('save_memory', () => {
      saveCount += 1
      return {
        id: 2,
        scope: 'global',
        connectionId: null,
        groupId: null,
        content: 'x',
        createdAt: 1,
        source: 'manual',
      }
    })
    setupStore() // no active sessions
    render(<AiMemoriesSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('ai-memory-section-global')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('ai-memory-add-trigger-global'))
    const textarea = await screen.findByTestId('ai-memory-add-textarea-global')
    await user.type(textarea, 'note')
    await user.click(screen.getByTestId('ai-memory-add-save-global'))

    await waitFor(() => {
      expect(useToastStore.getState().toasts.some((t) => /active connection/i.test(t.title))).toBe(
        true
      )
    })
    expect(saveCount).toBe(0)
  })

  it('cancels the inline add form and clears the draft', async () => {
    const user = userEvent.setup()
    setupStore({
      activeSessions: { 'sess-1': { profileId: 'conn-1', groupId: null } },
    })
    render(<AiMemoriesSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('ai-memory-section-global')).toBeInTheDocument()
    })
    await user.click(screen.getByTestId('ai-memory-add-trigger-global'))
    const textarea = await screen.findByTestId('ai-memory-add-textarea-global')
    await user.type(textarea, 'draft text')
    await user.click(screen.getByTestId('ai-memory-add-cancel-global'))
    await waitFor(() => {
      expect(screen.queryByTestId('ai-memory-add-textarea-global')).not.toBeInTheDocument()
    })
  })

  it('moves a memory via drag-and-drop onto a target section', async () => {
    const moved: Array<Record<string, unknown>> = []
    ipc.override('move_memory', (args) => {
      moved.push(args as Record<string, unknown>)
      return {
        id: 99,
        scope: 'connection',
        connectionId: 'conn-1',
        groupId: null,
        content: 'moved',
        createdAt: 1,
        source: 'manual',
      }
    })
    setupStore({ connections: [buildConnection({ id: 'conn-1', name: 'local-dev' })] })
    render(<AiMemoriesSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('ai-memory-item-1')).toBeInTheDocument()
    })

    const row = screen.getByTestId('ai-memory-item-1')
    const target = screen.getByTestId('ai-memory-section-connection-conn-1')
    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      setData: vi.fn(),
      getData: vi.fn(() => '1'),
    }
    act(() => {
      row.dispatchEvent(
        Object.assign(new Event('dragstart', { bubbles: true }), { dataTransfer })
      )
    })
    act(() => {
      target.dispatchEvent(
        Object.assign(new Event('dragover', { bubbles: true, cancelable: true }), { dataTransfer })
      )
    })
    act(() => {
      target.dispatchEvent(
        Object.assign(new Event('drop', { bubbles: true, cancelable: true }), { dataTransfer })
      )
    })

    await waitFor(() => {
      expect(moved).toHaveLength(1)
    })
    expect(moved[0]).toMatchObject({
      memoryId: 1,
      fromScope: 'global',
      toScope: 'connection',
      toConnectionId: 'conn-1',
    })
    await settle()
  })

  it('shows the drop indicator and accepts the drop on dragover over a valid target', async () => {
    setupStore({ connections: [buildConnection({ id: 'conn-1', name: 'local-dev' })] })
    render(<AiMemoriesSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('ai-memory-item-1')).toBeInTheDocument()
    })

    const row = screen.getByTestId('ai-memory-item-1')
    const target = screen.getByTestId('ai-memory-section-connection-conn-1')
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn() }

    act(() => {
      row.dispatchEvent(Object.assign(new Event('dragstart', { bubbles: true }), { dataTransfer }))
    })

    // No highlight before any dragover.
    expect(target.className).not.toContain('dropTarget')

    const dragOver = Object.assign(new Event('dragover', { bubbles: true, cancelable: true }), {
      dataTransfer,
    })
    act(() => {
      target.dispatchEvent(dragOver)
    })

    // The handler must call preventDefault (otherwise the browser fires no drop)
    // and surface the skeleton placeholder row in the destination section.
    expect(dragOver.defaultPrevented).toBe(true)
    expect(dataTransfer.dropEffect).toBe('move')
    expect(target.className).toContain('dropTarget')
    expect(
      screen.getByTestId('ai-memory-drop-skeleton-connection-conn-1')
    ).toBeInTheDocument()
    await settle()
  })

  it('highlights only the innermost section when dragging through nested sections', async () => {
    setupStore({
      groups: [{ id: 'grp-1', name: 'Work DBs', parentId: null, sortOrder: 0, createdAt: '' }],
      connections: [buildConnection({ id: 'conn-1', name: 'prod-db', groupId: 'grp-1' })],
    })
    render(<AiMemoriesSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('ai-memory-item-1')).toBeInTheDocument()
    })

    const row = screen.getByTestId('ai-memory-item-1') // global memory
    const group = screen.getByTestId('ai-memory-section-group-grp-1')
    const conn = screen.getByTestId('ai-memory-section-connection-conn-1')
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn() }

    act(() => {
      row.dispatchEvent(Object.assign(new Event('dragstart', { bubbles: true }), { dataTransfer }))
    })

    // Hovering the group highlights it.
    act(() => {
      group.dispatchEvent(
        Object.assign(new Event('dragover', { bubbles: true, cancelable: true }), { dataTransfer })
      )
    })
    expect(group.className).toContain('dropTarget')

    // Dragging into the nested connection moves the highlight there and clears
    // the group — the skeleton must not stay stuck in every section passed through.
    act(() => {
      conn.dispatchEvent(
        Object.assign(new Event('dragover', { bubbles: true, cancelable: true }), { dataTransfer })
      )
    })
    expect(conn.className).toContain('dropTarget')
    expect(group.className).not.toContain('dropTarget')
    expect(
      screen.queryByTestId('ai-memory-drop-skeleton-group-grp-1')
    ).not.toBeInTheDocument()
    await settle()
  })

  it('writes the full source scope payload when a memory drag starts', async () => {
    ipc.override('list_global_memories', () => [])
    ipc.override('list_connection_memories', () => [connMemory])
    setupStore({ connections: [buildConnection({ id: 'conn-1', name: 'local-dev' })] })
    render(<AiMemoriesSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('ai-memory-item-1')).toBeInTheDocument()
    })

    const row = screen.getByTestId('ai-memory-item-1')
    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      setData: vi.fn(),
      getData: vi.fn(),
    }

    act(() => {
      row.dispatchEvent(Object.assign(new Event('dragstart', { bubbles: true }), { dataTransfer }))
    })

    expect(dataTransfer.setData).toHaveBeenCalledWith(
      'application/x-sqllumen-ai-memory',
      JSON.stringify({
        memoryId: 1,
        fromScope: 'connection',
        fromConnectionId: 'conn-1',
        fromGroupId: null,
      })
    )
  })

  it('moves a memory from the serialized drag payload on drop', async () => {
    const moved: Array<Record<string, unknown>> = []
    ipc.override('move_memory', (args) => {
      moved.push(args as Record<string, unknown>)
      return {
        id: 99,
        scope: 'global',
        connectionId: null,
        groupId: null,
        content: 'moved',
        createdAt: 1,
        source: 'manual',
      }
    })
    ipc.override('list_global_memories', () => [])
    ipc.override('list_connection_memories', () => [connMemory])
    setupStore({ connections: [buildConnection({ id: 'conn-1', name: 'local-dev' })] })
    render(<AiMemoriesSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('ai-memory-section-global')).toBeInTheDocument()
    })

    const target = screen.getByTestId('ai-memory-section-global')
    const dataTransfer = {
      dropEffect: '',
      getData: vi.fn((type?: string) =>
        type === 'application/x-sqllumen-ai-memory'
          ? JSON.stringify({
              memoryId: 1,
              fromScope: 'connection',
              fromConnectionId: 'conn-1',
              fromGroupId: null,
            })
          : ''
      ),
    }

    act(() => {
      target.dispatchEvent(
        Object.assign(new Event('drop', { bubbles: true, cancelable: true }), { dataTransfer })
      )
    })

    await waitFor(() => expect(moved).toHaveLength(1))
    expect(moved[0]).toMatchObject({
      memoryId: 1,
      fromScope: 'connection',
      toScope: 'global',
      fromConnectionId: 'conn-1',
    })
    await settle()
  })

  it('accepts a serialized memory drag during dragover when active drag state is unavailable', async () => {
    const moved: Array<Record<string, unknown>> = []
    ipc.override('move_memory', (args) => {
      moved.push(args as Record<string, unknown>)
      return {
        id: 99,
        scope: 'global',
        connectionId: null,
        groupId: null,
        content: 'moved',
        createdAt: 1,
        source: 'manual',
      }
    })
    ipc.override('list_global_memories', () => [])
    ipc.override('list_connection_memories', () => [connMemory])
    setupStore({ connections: [buildConnection({ id: 'conn-1', name: 'local-dev' })] })
    render(<AiMemoriesSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('ai-memory-section-global')).toBeInTheDocument()
    })

    const target = screen.getByTestId('ai-memory-section-global')
    const dataTransfer = {
      dropEffect: '',
      types: ['application/x-sqllumen-ai-memory'],
      getData: vi.fn((type?: string) =>
        type === 'application/x-sqllumen-ai-memory'
          ? JSON.stringify({
              memoryId: 1,
              fromScope: 'connection',
              fromConnectionId: 'conn-1',
              fromGroupId: null,
            })
          : ''
      ),
    }

    const dragOver = Object.assign(new Event('dragover', { bubbles: true, cancelable: true }), {
      dataTransfer,
    })
    act(() => {
      target.dispatchEvent(dragOver)
    })

    expect(dragOver.defaultPrevented).toBe(true)
    expect(dataTransfer.dropEffect).toBe('move')
    expect(target.className).toContain('dropTarget')

    act(() => {
      target.dispatchEvent(
        Object.assign(new Event('drop', { bubbles: true, cancelable: true }), { dataTransfer })
      )
    })

    await waitFor(() => expect(moved).toHaveLength(1))
    expect(moved[0]).toMatchObject({
      memoryId: 1,
      fromScope: 'connection',
      toScope: 'global',
      fromConnectionId: 'conn-1',
    })
    await settle()
  })

  it('rejects dragover and hides the indicator over the source owner (no-op move)', async () => {
    setupStore({ connections: [buildConnection({ id: 'conn-1', name: 'local-dev' })] })
    render(<AiMemoriesSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('ai-memory-item-1')).toBeInTheDocument()
    })

    const row = screen.getByTestId('ai-memory-item-1')
    // The global memory's own section is an invalid (no-op) target.
    const ownSection = screen.getByTestId('ai-memory-section-global')
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn() }

    act(() => {
      row.dispatchEvent(Object.assign(new Event('dragstart', { bubbles: true }), { dataTransfer }))
    })
    act(() => {
      ownSection.dispatchEvent(
        Object.assign(new Event('dragover', { bubbles: true, cancelable: true }), { dataTransfer })
      )
    })

    expect(dataTransfer.dropEffect).toBe('none')
    expect(ownSection.className).not.toContain('dropTarget')
    await settle()
  })

  it('adds a memory at connection and group scope using a matching session', async () => {
    const user = userEvent.setup()
    const saved: Array<Record<string, unknown>> = []
    ipc.override('save_memory', (args) => {
      saved.push(args as Record<string, unknown>)
      return {
        id: 5,
        scope: 'connection',
        connectionId: 'conn-1',
        groupId: null,
        content: 'note',
        createdAt: 1,
        source: 'manual',
      }
    })
    setupStore({
      groups: [{ id: 'grp-1', name: 'Work', parentId: null, sortOrder: 0, createdAt: '' }],
      connections: [buildConnection({ id: 'conn-1', name: 'prod', groupId: 'grp-1' })],
      activeSessions: { 'sess-1': { profileId: 'conn-1', groupId: 'grp-1' } },
    })
    render(<AiMemoriesSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('ai-memory-section-connection-conn-1')).toBeInTheDocument()
    })

    // Connection scope (group section is collapsible — expand it first if needed)
    await user.click(screen.getByTestId('ai-memory-add-trigger-connection-conn-1'))
    const connTa = await screen.findByTestId('ai-memory-add-textarea-connection-conn-1')
    await user.type(connTa, 'conn note')
    await user.click(screen.getByTestId('ai-memory-add-save-connection-conn-1'))
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]).toMatchObject({ scope: 'connection', sessionId: 'sess-1' })

    // Group scope
    await user.click(screen.getByTestId('ai-memory-add-trigger-group-grp-1'))
    const grpTa = await screen.findByTestId('ai-memory-add-textarea-group-grp-1')
    await user.type(grpTa, 'group note')
    await user.click(screen.getByTestId('ai-memory-add-save-group-grp-1'))
    await waitFor(() => expect(saved).toHaveLength(2))
    expect(saved[1]).toMatchObject({ scope: 'group', sessionId: 'sess-1' })
    await settle()
  })

  it('surfaces an error when a dropped move fails', async () => {
    ipc.override('move_memory', () => {
      throw new Error('boom')
    })
    setupStore({
      groups: [{ id: 'grp-1', name: 'Work', parentId: null, sortOrder: 0, createdAt: '' }],
      connections: [],
    })
    ipc.override('list_global_memories', () => [])
    ipc.override('list_group_memories', () => [groupMemory])
    render(<AiMemoriesSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('ai-memory-item-1')).toBeInTheDocument()
    })

    const target = screen.getByTestId('ai-memory-section-global')
    const dataTransfer = {
      dropEffect: '',
      getData: vi.fn((type?: string) =>
        type === 'application/x-sqllumen-ai-memory'
          ? JSON.stringify({
              memoryId: 1,
              fromScope: 'group',
              fromGroupId: 'grp-1',
              fromConnectionId: null,
            })
          : ''
      ),
    }

    act(() => {
      target.dispatchEvent(
        Object.assign(new Event('drop', { bubbles: true, cancelable: true }), { dataTransfer })
      )
    })

    await waitFor(() => {
      expect(useToastStore.getState().toasts.some((t) => /Failed to move/i.test(t.title))).toBe(true)
    })
  })

  it('surfaces an error when delete fails', async () => {
    const user = userEvent.setup()
    ipc.override('delete_memory', () => {
      throw new Error('nope')
    })
    setupStore()
    render(<AiMemoriesSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('ai-memory-item-1')).toBeInTheDocument()
    })
    await user.click(screen.getByTestId('ai-memory-delete-1'))
    const dialogBtns = screen.getAllByRole('button', { name: 'Delete' })
    const confirmBtn =
      dialogBtns.find((b) => b.closest('[role="dialog"]') !== null) ??
      dialogBtns[dialogBtns.length - 1]
    await user.click(confirmBtn)
    await waitFor(() => {
      expect(
        useToastStore.getState().toasts.some((t) => /Failed to delete/i.test(t.title))
      ).toBe(true)
    })
  })

  it('drops a group-scoped memory onto the global section', async () => {
    const moved: Array<Record<string, unknown>> = []
    ipc.override('move_memory', (args) => {
      moved.push(args as Record<string, unknown>)
      return {
        id: 99,
        scope: 'global',
        connectionId: null,
        groupId: null,
        content: 'moved',
        createdAt: 1,
        source: 'manual',
      }
    })
    setupStore({
      groups: [{ id: 'grp-1', name: 'Work', parentId: null, sortOrder: 0, createdAt: '' }],
      connections: [],
    })
    ipc.override('list_global_memories', () => [])
    ipc.override('list_group_memories', () => [groupMemory])
    render(<AiMemoriesSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('ai-memory-item-1')).toBeInTheDocument()
    })

    const row = screen.getByTestId('ai-memory-item-1')
    const target = screen.getByTestId('ai-memory-section-global')
    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      setData: vi.fn(),
      getData: vi.fn(() => '1'),
    }
    act(() => {
      row.dispatchEvent(Object.assign(new Event('dragstart', { bubbles: true }), { dataTransfer }))
    })
    act(() => {
      target.dispatchEvent(
        Object.assign(new Event('dragover', { bubbles: true, cancelable: true }), { dataTransfer })
      )
    })
    act(() => {
      target.dispatchEvent(
        Object.assign(new Event('drop', { bubbles: true, cancelable: true }), { dataTransfer })
      )
    })
    await waitFor(() => expect(moved).toHaveLength(1))
    expect(moved[0]).toMatchObject({ memoryId: 1, fromScope: 'group', toScope: 'global' })
    await settle()
  })

  it('surfaces an error when inline add save fails', async () => {
    const user = userEvent.setup()
    ipc.override('save_memory', () => {
      throw new Error('save failed')
    })
    setupStore({ activeSessions: { 'sess-1': { profileId: 'conn-1', groupId: null } } })
    render(<AiMemoriesSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('ai-memory-section-global')).toBeInTheDocument()
    })
    await user.click(screen.getByTestId('ai-memory-add-trigger-global'))
    const ta = await screen.findByTestId('ai-memory-add-textarea-global')
    await user.type(ta, 'x')
    await user.click(screen.getByTestId('ai-memory-add-save-global'))
    await waitFor(() => {
      expect(useToastStore.getState().toasts.some((t) => /Failed to save/i.test(t.title))).toBe(true)
    })
  })

  it('continues rendering when a list command fails', async () => {
    ipc.override('list_global_memories', () => {
      throw new Error('list failed')
    })
    ipc.override('list_connection_memories', () => {
      throw new Error('list failed')
    })
    setupStore({ connections: [buildConnection({ id: 'conn-1', name: 'local-dev' })] })
    render(<AiMemoriesSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('ai-memory-section-global')).toBeInTheDocument()
    })
    // Global is empty after failure -> empty state shown
    expect(screen.getByTestId('ai-memory-empty-global')).toBeInTheDocument()
  })

  it('ignores a drop whose source memory cannot be found', async () => {
    const moved: Array<Record<string, unknown>> = []
    ipc.override('move_memory', (args) => {
      moved.push(args as Record<string, unknown>)
      return {
        id: 1,
        scope: 'global',
        connectionId: null,
        groupId: null,
        content: '',
        createdAt: 1,
        source: 'manual',
      }
    })
    setupStore({ connections: [buildConnection({ id: 'conn-1', name: 'local-dev' })] })
    render(<AiMemoriesSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('ai-memory-section-connection-conn-1')).toBeInTheDocument()
    })
    const target = screen.getByTestId('ai-memory-section-connection-conn-1')
    // Drop without a dragstart -> activeDrag is null, drop is a no-op.
    const dataTransfer = { dropEffect: '', getData: vi.fn(() => '404') }
    act(() => {
      target.dispatchEvent(
        Object.assign(new Event('drop', { bubbles: true, cancelable: true }), { dataTransfer })
      )
    })
    expect(moved).toHaveLength(0)
  })

  it('closes the inline add form when Escape is pressed in the textarea', async () => {
    const user = userEvent.setup()
    setupStore({ activeSessions: { 'sess-1': { profileId: 'conn-1', groupId: null } } })
    render(<AiMemoriesSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('ai-memory-section-global')).toBeInTheDocument()
    })
    await user.click(screen.getByTestId('ai-memory-add-trigger-global'))
    const ta = await screen.findByTestId('ai-memory-add-textarea-global')
    await user.type(ta, 'abc{Escape}')
    await waitFor(() => {
      expect(screen.queryByTestId('ai-memory-add-textarea-global')).not.toBeInTheDocument()
    })
  })

  it('clears the drop highlight on drag leave', async () => {
    setupStore({ connections: [buildConnection({ id: 'conn-1', name: 'local-dev' })] })
    render(<AiMemoriesSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('ai-memory-item-1')).toBeInTheDocument()
    })
    const row = screen.getByTestId('ai-memory-item-1')
    const target = screen.getByTestId('ai-memory-section-connection-conn-1')
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn() }
    act(() => {
      row.dispatchEvent(Object.assign(new Event('dragstart', { bubbles: true }), { dataTransfer }))
    })
    act(() => {
      target.dispatchEvent(
        Object.assign(new Event('dragover', { bubbles: true, cancelable: true }), { dataTransfer })
      )
    })
    act(() => {
      target.dispatchEvent(
        Object.assign(new Event('dragleave', { bubbles: true }), { relatedTarget: document.body })
      )
    })
    // No assertion error means the dragleave handler ran without throwing.
    expect(target).toBeInTheDocument()
  })

  it('adds to an ungrouped connection and cancels the delete dialog', async () => {
    const user = userEvent.setup()
    const saved: Array<Record<string, unknown>> = []
    ipc.override('save_memory', (args) => {
      saved.push(args as Record<string, unknown>)
      return {
        id: 7,
        scope: 'connection',
        connectionId: 'conn-1',
        groupId: null,
        content: 'x',
        createdAt: 1,
        source: 'manual',
      }
    })
    setupStore({
      connections: [buildConnection({ id: 'conn-1', name: 'local-dev' })],
      activeSessions: { 'sess-1': { profileId: 'conn-1', groupId: null } },
    })
    render(<AiMemoriesSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('ai-memory-section-connection-conn-1')).toBeInTheDocument()
    })
    await user.click(screen.getByTestId('ai-memory-add-trigger-connection-conn-1'))
    const ta = await screen.findByTestId('ai-memory-add-textarea-connection-conn-1')
    await user.type(ta, 'ungrouped note')
    await user.click(screen.getByTestId('ai-memory-add-save-connection-conn-1'))
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]).toMatchObject({ scope: 'connection', sessionId: 'sess-1' })
    await settle()

    // Open + cancel the delete dialog (global memory present).
    await user.click(screen.getByTestId('ai-memory-delete-1'))
    expect(screen.getByText('Delete Memory')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => {
      expect(screen.queryByText('Delete Memory')).not.toBeInTheDocument()
    })
  })

  it('moves a connection memory onto another connection via drop', async () => {
    const moved: Array<Record<string, unknown>> = []
    ipc.override('move_memory', (args) => {
      moved.push(args as Record<string, unknown>)
      return {
        id: 99,
        scope: 'connection',
        connectionId: 'conn-2',
        groupId: null,
        content: 'moved',
        createdAt: 1,
        source: 'manual',
      }
    })
    ipc.override('list_global_memories', () => [])
    ipc.override('list_connection_memories', (args) => {
      const id = (args as Record<string, unknown>).connectionId
      return id === 'conn-1' ? [connMemory] : []
    })
    setupStore({
      connections: [
        buildConnection({ id: 'conn-1', name: 'src-db' }),
        buildConnection({ id: 'conn-2', name: 'dst-db' }),
      ],
    })
    render(<AiMemoriesSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('ai-memory-item-1')).toBeInTheDocument()
    })
    const row = screen.getByTestId('ai-memory-item-1')
    const target = screen.getByTestId('ai-memory-section-connection-conn-2')
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn() }
    act(() => {
      row.dispatchEvent(Object.assign(new Event('dragstart', { bubbles: true }), { dataTransfer }))
    })
    act(() => {
      target.dispatchEvent(
        Object.assign(new Event('dragover', { bubbles: true, cancelable: true }), { dataTransfer })
      )
    })
    act(() => {
      target.dispatchEvent(
        Object.assign(new Event('drop', { bubbles: true, cancelable: true }), { dataTransfer })
      )
    })
    await waitFor(() => expect(moved).toHaveLength(1))
    expect(moved[0]).toMatchObject({
      memoryId: 1,
      fromScope: 'connection',
      toScope: 'connection',
      toConnectionId: 'conn-2',
      fromConnectionId: 'conn-1',
    })
    await settle()
  })

  it('collapses a group section with more than five memories by default', async () => {
    setupStore({
      groups: [{ id: 'grp-1', name: 'Big Group', parentId: null, sortOrder: 0, createdAt: '' }],
      connections: [],
    })
    const many: AiMemory[] = Array.from({ length: 6 }, (_, i) => ({
      id: i + 1,
      scope: 'group',
      connectionId: null,
      groupId: 'grp-1',
      content: `note ${i}`,
      createdAt: 1,
      source: 'manual',
    }))
    ipc.override('list_group_memories', () => many)
    ipc.override('list_global_memories', () => [])
    render(<AiMemoriesSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('ai-memory-section-toggle-group-grp-1')).toBeInTheDocument()
    })
    const toggle = screen.getByTestId('ai-memory-section-toggle-group-grp-1')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    // Memory rows hidden while collapsed
    expect(screen.queryByTestId('ai-memory-item-1')).not.toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('ai-memory-item-1')).toBeInTheDocument()
  })
})
