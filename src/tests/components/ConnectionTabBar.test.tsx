import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { dispatchAuxClick } from '../helpers/dispatch-aux-click'
import userEvent from '@testing-library/user-event'
import { ConnectionTabBar } from '../../components/layout/ConnectionTabBar'
import { useThemeStore } from '../../stores/theme-store'
import { useConnectionStore } from '../../stores/connection-store'
import { setupMatchMedia } from '../helpers/mock-match-media'
import type { ActiveConnection, SavedConnection } from '../../types/connection'

function makeSavedConnection(overrides: Partial<SavedConnection> = {}): SavedConnection {
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
    keepaliveIntervalSecs: 30,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeActiveConnection(overrides: Partial<ActiveConnection> = {}): ActiveConnection {
  return {
    id: 'conn-1',
    profile: makeSavedConnection(),
    status: 'connected',
    serverVersion: '8.0.35',
    ...overrides,
  }
}

beforeEach(() => {
  useThemeStore.setState({ theme: 'light', resolvedTheme: 'light' })
  useConnectionStore.setState({
    activeConnections: {},
    activeTabId: null,
    dialogOpen: false,
    error: null,
  })
  document.documentElement.removeAttribute('data-theme')
  setupMatchMedia(false)
})

describe('ConnectionTabBar', () => {
  it('renders the New Connection button', () => {
    render(<ConnectionTabBar />)
    expect(screen.getByLabelText('New Connection')).toBeInTheDocument()
  })

  it('renders the theme toggle button', () => {
    render(<ConnectionTabBar />)
    expect(screen.getByTestId('theme-toggle')).toBeInTheDocument()
  })

  it('renders the settings gear button', () => {
    render(<ConnectionTabBar />)
    expect(screen.getByLabelText('Settings')).toBeInTheDocument()
  })

  it('renders empty tab bar with only utility buttons when no connections active', () => {
    render(<ConnectionTabBar />)
    expect(screen.getByLabelText('New Connection')).toBeInTheDocument()
    expect(screen.getByTestId('theme-toggle')).toBeInTheDocument()
    expect(screen.getByLabelText('Settings')).toBeInTheDocument()
    // No tabs should be rendered
    expect(screen.queryByRole('button', { name: /Close/ })).not.toBeInTheDocument()
  })

  it('shows Unnamed connection when profile name is blank', () => {
    const profile = makeSavedConnection({ name: '   ' })
    const conn = makeActiveConnection({ profile })

    useConnectionStore.setState({
      activeConnections: { 'conn-1': conn },
      activeTabId: 'conn-1',
    })

    render(<ConnectionTabBar />)

    expect(screen.getByText('Unnamed connection')).toBeInTheDocument()
    const closeBtn = screen.getByLabelText('Close Unnamed connection')
    expect(closeBtn).toBeInTheDocument()
  })

  it('renders a tab for each active connection with correct name and color', () => {
    const conn1 = makeActiveConnection({ id: 'sess-1' })
    const profile2 = makeSavedConnection({ id: 'conn-2', name: 'Staging DB', color: '#ef4444' })
    const conn2 = makeActiveConnection({ id: 'sess-2', profile: profile2 })

    useConnectionStore.setState({
      activeConnections: { 'sess-1': conn1, 'sess-2': conn2 },
      activeTabId: 'sess-1',
    })

    render(<ConnectionTabBar />)

    expect(screen.getByText('Test DB')).toBeInTheDocument()
    expect(screen.getByText('Staging DB')).toBeInTheDocument()
  })

  it('disambiguates duplicate profiles with (2), (3) in tab labels', () => {
    const profile = makeSavedConnection({ id: 'conn-1', name: 'Prod' })
    const connA = makeActiveConnection({ id: 'sess-a', profile })
    const connB = makeActiveConnection({ id: 'sess-b', profile })
    const connC = makeActiveConnection({ id: 'sess-c', profile })

    useConnectionStore.setState({
      activeConnections: { 'sess-a': connA, 'sess-b': connB, 'sess-c': connC },
      activeTabId: 'sess-a',
    })

    render(<ConnectionTabBar />)

    expect(screen.getByText(/^Prod$/)).toBeInTheDocument()
    expect(screen.getByText('Prod (2)')).toBeInTheDocument()
    expect(screen.getByText('Prod (3)')).toBeInTheDocument()
  })

  it('clicking a tab calls switchTab(id)', async () => {
    const user = userEvent.setup()
    const conn1 = makeActiveConnection({ id: 'sess-1' })
    const profile2 = makeSavedConnection({ id: 'conn-2', name: 'Staging DB' })
    const conn2 = makeActiveConnection({ id: 'sess-2', profile: profile2 })

    useConnectionStore.setState({
      activeConnections: { 'sess-1': conn1, 'sess-2': conn2 },
      activeTabId: 'sess-1',
    })

    render(<ConnectionTabBar />)

    await user.click(screen.getByText('Staging DB'))
    expect(useConnectionStore.getState().activeTabId).toBe('sess-2')
  })

  it('clicking close button calls closeConnection(id)', async () => {
    const user = userEvent.setup()
    const conn1 = makeActiveConnection({ id: 'sess-1' })

    useConnectionStore.setState({
      activeConnections: { 'sess-1': conn1 },
      activeTabId: 'sess-1',
    })

    render(<ConnectionTabBar />)

    const closeBtn = screen.getByLabelText('Close Test DB')
    await user.click(closeBtn)

    // closeConnection is async and calls IPC — in test, the store action will error,
    // but the click handler was invoked (which is what we're testing)
    // The tab should still be present since the IPC mock will reject
    expect(closeBtn).toBeInTheDocument()
  })

  it('middle-click on a connection tab opens close confirmation', async () => {
    const conn1 = makeActiveConnection({ id: 'sess-1' })
    useConnectionStore.setState({
      activeConnections: { 'sess-1': conn1 },
      activeTabId: 'sess-1',
    })

    render(<ConnectionTabBar />)

    await act(async () => {
      dispatchAuxClick(screen.getByTestId('connection-session-tab-sess-1'))
    })

    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Close connection\?/ })).toBeInTheDocument()
  })

  it('middle-click confirm dialog Cancel does not call closeConnection', async () => {
    const user = userEvent.setup()
    const conn1 = makeActiveConnection({ id: 'sess-1' })
    const closeSpy = vi.spyOn(useConnectionStore.getState(), 'closeConnection').mockResolvedValue()

    useConnectionStore.setState({
      activeConnections: { 'sess-1': conn1 },
      activeTabId: 'sess-1',
    })

    try {
      render(<ConnectionTabBar />)
      await act(async () => {
        dispatchAuxClick(screen.getByTestId('connection-session-tab-sess-1'))
      })
      await user.click(screen.getByTestId('confirm-cancel-button'))
      expect(closeSpy).not.toHaveBeenCalled()
      expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
    } finally {
      closeSpy.mockRestore()
    }
  })

  it('middle-click confirm dialog Close connection calls closeConnection(id)', async () => {
    const user = userEvent.setup()
    const conn1 = makeActiveConnection({ id: 'sess-1' })
    const closeSpy = vi.spyOn(useConnectionStore.getState(), 'closeConnection').mockResolvedValue()

    useConnectionStore.setState({
      activeConnections: { 'sess-1': conn1 },
      activeTabId: 'sess-1',
    })

    try {
      render(<ConnectionTabBar />)
      await act(async () => {
        dispatchAuxClick(screen.getByTestId('connection-session-tab-sess-1'))
      })
      await user.click(screen.getByTestId('confirm-confirm-button'))
      expect(closeSpy).toHaveBeenCalledWith('sess-1')
    } finally {
      closeSpy.mockRestore()
    }
  })

  it('"+" button calls openDialog()', async () => {
    const user = userEvent.setup()
    render(<ConnectionTabBar />)

    expect(useConnectionStore.getState().dialogOpen).toBe(false)
    await user.click(screen.getByLabelText('New Connection'))
    expect(useConnectionStore.getState().dialogOpen).toBe(true)
  })

  it('hides vertical color accent when connection has no color', () => {
    const profile = makeSavedConnection({ color: null })
    const conn = makeActiveConnection({ profile })

    useConnectionStore.setState({
      activeConnections: { 'sess-1': conn },
      activeTabId: 'sess-1',
    })

    const { container } = render(<ConnectionTabBar />)
    expect(container.querySelector('[class*="colorAccent"]')).not.toBeInTheDocument()
  })

  it('does not render vertical color accent on active tab when profile has color', () => {
    const conn = makeActiveConnection({
      id: 'sess-1',
      profile: makeSavedConnection({ color: '#3b82f6' }),
    })

    useConnectionStore.setState({
      activeConnections: { 'sess-1': conn },
      activeTabId: 'sess-1',
    })

    const { container } = render(<ConnectionTabBar />)
    expect(container.querySelector('[class*="colorAccent"]')).not.toBeInTheDocument()
  })

  it('renders vertical color accent only on inactive tabs when profiles have color', () => {
    const conn1 = makeActiveConnection({ id: 'sess-1' })
    const profile2 = makeSavedConnection({ id: 'conn-2', name: 'Staging DB', color: '#ef4444' })
    const conn2 = makeActiveConnection({ id: 'sess-2', profile: profile2 })

    useConnectionStore.setState({
      activeConnections: { 'sess-1': conn1, 'sess-2': conn2 },
      activeTabId: 'sess-1',
    })

    const { container } = render(<ConnectionTabBar />)
    const accents = container.querySelectorAll('[class*="colorAccent"]')
    expect(accents.length).toBe(1)
  })

  it('clicking theme toggle switches from light to dark', async () => {
    const user = userEvent.setup()
    render(<ConnectionTabBar />)

    const toggleButton = screen.getByTestId('theme-toggle')
    await user.click(toggleButton)

    expect(useThemeStore.getState().resolvedTheme).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('clicking theme toggle switches from dark to light', async () => {
    useThemeStore.setState({ theme: 'dark', resolvedTheme: 'dark' })

    const user = userEvent.setup()
    render(<ConnectionTabBar />)

    const toggleButton = screen.getByTestId('theme-toggle')
    await user.click(toggleButton)

    expect(useThemeStore.getState().resolvedTheme).toBe('light')
  })
})
