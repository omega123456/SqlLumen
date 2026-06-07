import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandPalette } from '../../../components/command-palette/CommandPalette'
import { hydrateFromSnapshot } from '../../../components/query-editor/schema-metadata-cache'
import { useCommandPaletteStore } from '../../../stores/command-palette-store'
import { useConnectionStore } from '../../../stores/connection-store'
import { useCommandPaletteRecentsStore } from '../../../stores/command-palette-recents-store'
import type { ActiveConnection } from '../../../types/connection'
import { ipc } from '../../ipc-mock'
import * as ObjectActivationModule from '../../../lib/object-activation'

// Use vi.spyOn (not vi.mock) to stub the shared object-activation module per-test, so the
// palette's selection flow is exercised without driving the real tab-open + tree-reveal.
const activateObjectFromPaletteMock = vi.fn<
  (connectionId: string, database: string, objectType: string, name: string) => Promise<void>
>(() => Promise.resolve())

function makeActiveConnection(): ActiveConnection {
  return {
    id: 'session-1',
    profile: {
      id: 'profile-1',
      name: 'Local',
      host: '127.0.0.1',
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
      createdAt: '2026-06-06T12:00:00.000Z',
      updatedAt: '2026-06-06T12:00:00.000Z',
    },
    sessionDatabase: null,
    status: 'connected',
    serverVersion: '8.0.36',
  }
}

describe('CommandPalette', () => {
  beforeEach(() => {
    vi.useRealTimers()
    activateObjectFromPaletteMock.mockReset()
    vi.spyOn(ObjectActivationModule, 'activateObjectFromPalette').mockImplementation(
      (connectionId, database, objectType, name) =>
        activateObjectFromPaletteMock(connectionId, database, objectType, name)
    )
    useCommandPaletteStore.setState({ isOpen: false })
    useConnectionStore.setState({
      activeConnections: {},
      activeConnectionOrder: [],
      activeTabId: null,
      dialogOpen: false,
      error: null,
    })
    useCommandPaletteRecentsStore.setState({
      recentsByProfile: {},
      isInitialized: true,
    })
    ipc.override('set_setting', () => undefined)
  })

  it('renders a no-connection empty state when opened without an active connection', async () => {
    useCommandPaletteStore.setState({ isOpen: true })

    render(<CommandPalette />)

    expect(await screen.findByTestId('command-palette-empty-state')).toHaveTextContent(
      'No active connection'
    )
    expect(ipc.calls('fetch_schema_metadata_full')).toEqual([])
  })

  it('searches cached objects and activates the active result on Enter', async () => {
    vi.useFakeTimers()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    const activeConnection = makeActiveConnection()
    useConnectionStore.setState({
      activeConnections: { 'session-1': activeConnection },
      activeConnectionOrder: ['session-1'],
      activeTabId: 'session-1',
    })
    hydrateFromSnapshot(
      JSON.stringify({
        databases: ['analytics'],
        tables: {
          analytics: [
            {
              name: 'users',
              engine: 'InnoDB',
              charset: 'utf8mb4',
              rowCount: 0,
              dataSize: 0,
            },
          ],
        },
        views: { analytics: [{ name: 'user_rollup' }] },
        columns: {},
        routines: { analytics: [{ name: 'sync_users', routineType: 'PROCEDURE' }] },
        triggers: { analytics: [{ name: 'users_after_insert' }] },
        foreignKeys: {},
        indexes: {},
      }),
      'session-1'
    )
    useCommandPaletteStore.setState({ isOpen: true })

    render(<CommandPalette />)

    const input = await screen.findByTestId('command-palette-input')
    await user.type(input, 'user')
    await act(async () => {
      vi.advanceTimersByTime(85)
    })

    expect(await screen.findByTestId('command-palette-results')).toBeInTheDocument()
    expect(
      screen
        .getAllByRole('option')
        .some((option) => option.textContent?.includes('users · analytics'))
    ).toBe(true)

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const activeRow = screen
        .getAllByRole('option')
        .find((option) => option.getAttribute('data-active') === 'true')
      if (activeRow?.textContent?.trim().startsWith('users · analytics')) {
        break
      }
      await user.keyboard('{ArrowDown}')
    }

    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(activateObjectFromPaletteMock).toHaveBeenCalledWith(
        'session-1',
        'analytics',
        'table',
        'users'
      )
    })

    expect(useCommandPaletteRecentsStore.getState().getRecents('profile-1')[0]).toMatchObject({
      database: 'analytics',
      objectType: 'table',
      name: 'users',
    })
    expect(useCommandPaletteStore.getState().isOpen).toBe(false)
  })

  it('closes on Escape and restores focus to the previously active element', async () => {
    const user = userEvent.setup()

    function Harness() {
      return (
        <div>
          <button type="button">Before</button>
          <CommandPalette />
        </div>
      )
    }

    render(<Harness />)
    const button = screen.getByRole('button', { name: 'Before' })
    button.focus()

    act(() => {
      useCommandPaletteStore.getState().open()
    })

    const input = await screen.findByTestId('command-palette-input')
    await waitFor(() => {
      expect(input).toHaveFocus()
    })

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(useCommandPaletteStore.getState().isOpen).toBe(false)
    })
    expect(button).toHaveFocus()
  })

  it('creates pills from inline slash commands and removes the rightmost pill on backspace', async () => {
    vi.useFakeTimers()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const activeConnection = makeActiveConnection()

    useConnectionStore.setState({
      activeConnections: { 'session-1': activeConnection },
      activeConnectionOrder: ['session-1'],
      activeTabId: 'session-1',
    })
    hydrateFromSnapshot(
      JSON.stringify({
        databases: ['analytics', 'app_main'],
        tables: {
          analytics: [
            { name: 'users', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 0, dataSize: 0 },
          ],
          app_main: [
            { name: 'users', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 0, dataSize: 0 },
          ],
        },
        views: {},
        columns: {},
        routines: {},
        triggers: {},
        foreignKeys: {},
        indexes: {},
      }),
      'session-1'
    )
    useCommandPaletteStore.setState({ isOpen: true })

    render(<CommandPalette />)

    const input = await screen.findByTestId('command-palette-input')
    await user.type(input, '/table /analytics users')
    await act(async () => {
      vi.advanceTimersByTime(85)
    })

    expect(screen.getByTestId('command-palette-pill-type')).toHaveTextContent('Tables')
    expect(screen.getByTestId('command-palette-pill-database')).toHaveTextContent('analytics')
    expect(screen.getByText('users')).toBeInTheDocument()
    expect(screen.queryByText('app_main')).not.toBeInTheDocument()

    await user.clear(input)
    await user.keyboard('{Backspace}')

    expect(screen.queryByTestId('command-palette-pill-database')).not.toBeInTheDocument()
    expect(screen.getByTestId('command-palette-pill-type')).toBeInTheDocument()
  })

  it('shows the slash dropdown and applies a selected database pill', async () => {
    const user = userEvent.setup()
    const activeConnection = makeActiveConnection()

    useConnectionStore.setState({
      activeConnections: { 'session-1': activeConnection },
      activeConnectionOrder: ['session-1'],
      activeTabId: 'session-1',
    })
    hydrateFromSnapshot(
      JSON.stringify({
        databases: ['analytics'],
        tables: { analytics: [] },
        views: {},
        columns: {},
        routines: {},
        triggers: {},
        foreignKeys: {},
        indexes: {},
      }),
      'session-1'
    )
    useCommandPaletteStore.setState({ isOpen: true })

    render(<CommandPalette />)

    const input = await screen.findByTestId('command-palette-input')
    await user.type(input, '/')

    expect(await screen.findByTestId('command-palette-slash-dropdown')).toBeInTheDocument()

    await user.click(screen.getByRole('option', { name: /analytics/i }))

    expect(screen.getByTestId('command-palette-pill-database')).toHaveTextContent('analytics')
    expect(screen.queryByTestId('command-palette-slash-dropdown')).not.toBeInTheDocument()
  })

  it('applies the highlighted database pill on Enter from the filtered slash dropdown', async () => {
    vi.useFakeTimers()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const activeConnection = makeActiveConnection()

    useConnectionStore.setState({
      activeConnections: { 'session-1': activeConnection },
      activeConnectionOrder: ['session-1'],
      activeTabId: 'session-1',
    })
    hydrateFromSnapshot(
      JSON.stringify({
        databases: ['analytics', 'app_main'],
        tables: {
          analytics: [
            { name: 'users', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 0, dataSize: 0 },
          ],
          app_main: [
            { name: 'users', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 0, dataSize: 0 },
          ],
        },
        views: {},
        columns: {},
        routines: {},
        triggers: {},
        foreignKeys: {},
        indexes: {},
      }),
      'session-1'
    )
    useCommandPaletteStore.setState({ isOpen: true })

    render(<CommandPalette />)

    const input = await screen.findByTestId('command-palette-input')
    // Type a slash query that matches ONLY the analytics database (no keyword aliases match).
    await user.type(input, '/analyt')

    expect(await screen.findByTestId('command-palette-slash-dropdown')).toBeInTheDocument()
    // Only the analytics database option should be present in the filtered list.
    expect(screen.getByRole('option', { name: /analytics/i })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /app_main/i })).not.toBeInTheDocument()

    // Highlight the first (and only) filtered option and confirm via keyboard.
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')

    // A DATABASE pill must be applied (not a type pill) — this was the broken path.
    expect(screen.getByTestId('command-palette-pill-database')).toHaveTextContent('analytics')
    expect(screen.queryByTestId('command-palette-pill-type')).not.toBeInTheDocument()

    // The database filter must actually constrain results: searching "users" with the
    // analytics pill applied must NOT surface the identically-named app_main table.
    await user.type(input, 'users')
    await act(async () => {
      vi.advanceTimersByTime(85)
    })

    const results = await screen.findByTestId('command-palette-results')
    expect(results).toBeInTheDocument()
    const optionTexts = screen.getAllByRole('option').map((option) => option.textContent ?? '')
    expect(optionTexts.some((text) => text.includes('users · analytics'))).toBe(true)
    expect(optionTexts.some((text) => text.includes('app_main'))).toBe(false)
  })
})
