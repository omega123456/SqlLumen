import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProcessListToolbar } from '../../../components/processlist/ProcessListToolbar'
import { useProcessListStore } from '../../../stores/processlist-store'
import { useConnectionStore } from '../../../stores/connection-store'
import type { ActiveConnection, SavedConnection } from '../../../types/connection'
import { ipc, expectToast } from '../../ipc-mock'

function makeSavedConnection(overrides: Partial<SavedConnection> = {}): SavedConnection {
  return {
    id: 'profile-1',
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
    keepaliveIntervalSecs: 30,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  // Default: kill_queries returns empty (no processes killed)
  ipc.override('kill_queries', () => [])

  const conn: ActiveConnection = {
    id: 'conn-1',
    profile: makeSavedConnection(),
    status: 'connected',
    serverVersion: '8.0.35',
  }
  act(() => {
    useConnectionStore.setState({
      activeConnections: { 'conn-1': conn },
      activeTabId: 'conn-1',
    })
  })

  act(() => {
    useProcessListStore.setState({
      rowsByConnection: {
        'conn-1': [
          {
            id: 10,
            user: 'root',
            host: 'localhost',
            db: 'test',
            command: 'Query',
            time: 5,
            state: 'running',
            info: 'SELECT 1',
          },
        ],
      },
      lastRefreshedAtByConnection: { 'conn-1': Date.now() },
      selectedIdsByConnection: {},
      refreshIntervalMsByConnection: { 'conn-1': 5000 },
      excludeIdleConnectionsByConnection: {},
      isConfirmDialogOpenByConnection: {},
      isSummaryDialogOpenByConnection: {},
      sortColumnByConnection: {},
      lastErrorToastAtByConnection: {},
      fetchErrorByConnection: {},
      isFetchingByConnection: {},
      fetchGenerationByConnection: {},
      hasFetchedByConnection: {},
    })
  })
})

describe('ProcessListToolbar', () => {
  it('renders refresh button and kill button', () => {
    render(<ProcessListToolbar connectionId="conn-1" sessionId="conn-1" onRefresh={vi.fn()} />)
    expect(screen.getByTestId('processlist-refresh-button')).toBeInTheDocument()
    expect(screen.getByTestId('processlist-kill-button')).toBeInTheDocument()
  })

  it('shows process count via StatusArea', () => {
    render(<ProcessListToolbar connectionId="conn-1" sessionId="conn-1" onRefresh={vi.fn()} />)
    expect(screen.getByTestId('status-area')).toBeInTheDocument()
    expect(screen.getByText('1 Rows')).toBeInTheDocument()
  })

  it('shows read-only badge when connection is read-only', () => {
    const conn: ActiveConnection = {
      id: 'conn-1',
      profile: makeSavedConnection({ readOnly: true }),
      status: 'connected',
      serverVersion: '8.0.35',
    }
    act(() => {
      useConnectionStore.setState({ activeConnections: { 'conn-1': conn } })
    })

    render(<ProcessListToolbar connectionId="conn-1" sessionId="conn-1" onRefresh={vi.fn()} />)

    expect(screen.getByTestId('processlist-readonly-badge')).toBeInTheDocument()
    expect(screen.getByText(/READ-ONLY/)).toBeInTheDocument()
  })

  it('calls onRefresh when refresh button is clicked', async () => {
    const onRefresh = vi.fn()
    const user = userEvent.setup()
    render(<ProcessListToolbar connectionId="conn-1" sessionId="conn-1" onRefresh={onRefresh} />)
    await user.click(screen.getByTestId('processlist-refresh-button'))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('disables kill button when no rows are selected', () => {
    render(<ProcessListToolbar connectionId="conn-1" sessionId="conn-1" onRefresh={vi.fn()} />)
    expect(screen.getByTestId('processlist-kill-button')).toBeDisabled()
  })

  it('enables kill button when rows are selected', () => {
    act(() => {
      useProcessListStore.setState({
        selectedIdsByConnection: { 'conn-1': new Set([10]) },
      })
    })
    render(<ProcessListToolbar connectionId="conn-1" sessionId="conn-1" onRefresh={vi.fn()} />)
    expect(screen.getByTestId('processlist-kill-button')).not.toBeDisabled()
  })

  it('enables kill button when a row is selected on a read-only connection', () => {
    const conn: ActiveConnection = {
      id: 'conn-1',
      profile: makeSavedConnection({ readOnly: true }),
      status: 'connected',
      serverVersion: '8.0.35',
    }
    act(() => {
      useConnectionStore.setState({ activeConnections: { 'conn-1': conn } })
      useProcessListStore.setState({
        selectedIdsByConnection: { 'conn-1': new Set([10]) },
      })
    })
    render(<ProcessListToolbar connectionId="conn-1" sessionId="conn-1" onRefresh={vi.fn()} />)
    expect(screen.getByTestId('processlist-kill-button')).not.toBeDisabled()
  })

  it('shows Kill N when N processes are selected', () => {
    act(() => {
      useProcessListStore.setState({
        selectedIdsByConnection: { 'conn-1': new Set([10]) },
      })
    })
    render(<ProcessListToolbar connectionId="conn-1" sessionId="conn-1" onRefresh={vi.fn()} />)
    expect(screen.getByTestId('processlist-kill-button')).toHaveTextContent('Kill 1 Query')
  })

  it('renders interval dropdown', () => {
    render(<ProcessListToolbar connectionId="conn-1" sessionId="conn-1" onRefresh={vi.fn()} />)
    expect(screen.getByTestId('processlist-interval-dropdown')).toBeInTheDocument()
  })

  it('defaults the filter dropdown to exclude idle', () => {
    render(<ProcessListToolbar connectionId="conn-1" sessionId="conn-1" onRefresh={vi.fn()} />)

    expect(screen.getByTestId('processlist-filter-dropdown')).toHaveTextContent('Exclude idle')
  })

  it('Dropdown root element should support content-based width', () => {
    render(<ProcessListToolbar connectionId="conn-1" sessionId="conn-1" onRefresh={vi.fn()} />)

    const filterTrigger = screen.getByTestId('processlist-filter-dropdown')
    const rootElement = filterTrigger.closest('.ui-dropdown') as HTMLElement
    expect(rootElement).toBeTruthy()
    // The root element should have the autoWidthDropdown class that sets width: fit-content
    expect(rootElement.className).toMatch(/autoWidthDropdown/)
  })

  it('updates the filter dropdown state when show all is selected', async () => {
    const user = userEvent.setup()

    render(<ProcessListToolbar connectionId="conn-1" sessionId="conn-1" onRefresh={vi.fn()} />)

    await user.click(screen.getByTestId('processlist-filter-dropdown'))
    await user.click(screen.getByTestId('processlist-filter-dropdown-option-show-all'))

    expect(useProcessListStore.getState().excludeIdleConnectionsByConnection['conn-1']).toBe(false)
    expect(screen.getByTestId('processlist-filter-dropdown')).toHaveTextContent('Show all')
  })

  it('shows the filtered process count when idle rows are excluded', () => {
    act(() => {
      useProcessListStore.setState({
        rowsByConnection: {
          'conn-1': [
            {
              id: 10,
              user: 'root',
              host: 'localhost',
              db: 'test',
              command: 'Query',
              time: 5,
              state: 'running',
              info: 'SELECT 1',
            },
            {
              id: 11,
              user: 'app',
              host: 'localhost',
              db: 'test',
              command: 'Sleep',
              time: 25,
              state: 'idle',
              info: 'SELECT SLEEP(25)',
            },
          ],
        },
      })
    })

    render(<ProcessListToolbar connectionId="conn-1" sessionId="conn-1" onRefresh={vi.fn()} />)

    expect(screen.getByText('1 Rows')).toBeInTheDocument()
  })

  it('opens confirm dialog and shows truncated SQL on kill click', async () => {
    act(() => {
      useProcessListStore.setState({
        selectedIdsByConnection: { 'conn-1': new Set([10]) },
        isConfirmDialogOpenByConnection: { 'conn-1': true },
      })
    })
    render(<ProcessListToolbar connectionId="conn-1" sessionId="conn-1" onRefresh={vi.fn()} />)
    // The confirm dialog should be open and show the process ID with truncated SQL
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
    expect(screen.getByText(/ID 10/)).toBeInTheDocument()
    expect(screen.getByText(/SELECT 1/)).toBeInTheDocument()
  })

  it('handles kill error with toast and logging', async () => {
    act(() => {
      useProcessListStore.setState({
        selectedIdsByConnection: { 'conn-1': new Set([10]) },
        isConfirmDialogOpenByConnection: { 'conn-1': true },
      })
    })

    // Override killSelectedProcesses to throw
    const originalKill = useProcessListStore.getState().killSelectedProcesses
    act(() => {
      useProcessListStore.setState({
        killSelectedProcesses: vi.fn().mockRejectedValue(new Error('Connection lost')),
      })
    })

    render(<ProcessListToolbar connectionId="conn-1" sessionId="conn-1" onRefresh={vi.fn()} />)

    // Click the Kill button in the confirm dialog
    const confirmBtn = screen.getByRole('button', { name: 'Kill' })
    await userEvent.click(confirmBtn)

    // Should close the confirm dialog after error
    await vi.waitFor(() => {
      expect(useProcessListStore.getState().isConfirmDialogOpenByConnection['conn-1']).toBeFalsy()
    })

    await vi.waitFor(async () => {
      await expectToast('error', 'Kill failed')
    })

    // Restore
    act(() => {
      useProcessListStore.setState({ killSelectedProcesses: originalKill })
    })
  })

  it('shows success toast and summary dialog after successful kill and clears selection on dismiss', async () => {
    act(() => {
      useProcessListStore.setState({
        selectedIdsByConnection: { 'conn-1': new Set([10]) },
        isConfirmDialogOpenByConnection: { 'conn-1': true },
      })
    })

    ipc.override('kill_queries', () => [{ id: 10, success: true, error: null }])

    render(<ProcessListToolbar connectionId="conn-1" sessionId="conn-1" onRefresh={vi.fn()} />)

    // Click the Kill button in the confirm dialog
    const confirmBtn = screen.getByRole('button', { name: 'Kill' })
    await userEvent.click(confirmBtn)

    // Summary dialog should appear
    await vi.waitFor(() => {
      expect(screen.getByTestId('kill-summary-dialog')).toBeInTheDocument()
    })

    await vi.waitFor(async () => {
      await expectToast('success', '1 process killed')
    })

    // Click Done to dismiss summary
    await userEvent.click(screen.getByTestId('kill-summary-done-button'))

    // Selection should be cleared
    await vi.waitFor(() => {
      const selected = useProcessListStore.getState().selectedIdsByConnection['conn-1']
      expect(selected?.size ?? 0).toBe(0)
    })
  })

  it('shows warning toast when kill returns failures', async () => {
    act(() => {
      useProcessListStore.setState({
        selectedIdsByConnection: { 'conn-1': new Set([10]) },
        isConfirmDialogOpenByConnection: { 'conn-1': true },
      })
    })

    ipc.override('kill_queries', () => [{ id: 10, success: false, error: 'Access denied' }])

    render(<ProcessListToolbar connectionId="conn-1" sessionId="conn-1" onRefresh={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Kill' }))

    await vi.waitFor(async () => {
      await expectToast('warning', '1 process failed to kill')
    })
  })

  it('shows both success and warning toasts for mixed kill results', async () => {
    act(() => {
      useProcessListStore.setState({
        rowsByConnection: {
          'conn-1': [
            {
              id: 10,
              user: 'root',
              host: 'localhost',
              db: 'test',
              command: 'Query',
              time: 5,
              state: 'running',
              info: 'SELECT 1',
            },
            {
              id: 11,
              user: 'app',
              host: 'localhost',
              db: 'test',
              command: 'Query',
              time: 1,
              state: 'running',
              info: 'SELECT 2',
            },
          ],
        },
        selectedIdsByConnection: { 'conn-1': new Set([10, 11]) },
        isConfirmDialogOpenByConnection: { 'conn-1': true },
      })
    })

    ipc.override('kill_queries', () => [
      { id: 10, success: true, error: null },
      { id: 11, success: false, error: 'Permission denied' },
    ])

    render(<ProcessListToolbar connectionId="conn-1" sessionId="conn-1" onRefresh={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Kill' }))

    await vi.waitFor(async () => {
      await expectToast('success', '1 process killed')
      await expectToast('warning', '1 process failed to kill')
    })
  })
})
