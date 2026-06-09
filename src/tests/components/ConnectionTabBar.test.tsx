import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    activeConnectionOrder: [],
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
      activeConnectionOrder: ['sess-1', 'sess-2'],
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
      activeConnectionOrder: ['sess-a', 'sess-b', 'sess-c'],
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
      activeConnectionOrder: ['sess-1', 'sess-2'],
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

    // closeConnection is async and calls IPC. The global IPC fixture returns success for
    // close_connection, so the connection is removed from the store after clicking.
    // Assert the connection was removed (the tab disappears), confirming the handler fired.
    await waitFor(() => {
      expect(useConnectionStore.getState().activeConnections['sess-1']).toBeUndefined()
    })
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
    const closeSpy = vi
      .spyOn(useConnectionStore.getState(), 'closeConnection')
      .mockResolvedValue(true)

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
    const closeSpy = vi
      .spyOn(useConnectionStore.getState(), 'closeConnection')
      .mockResolvedValue(true)

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
      activeConnectionOrder: ['sess-1', 'sess-2'],
      activeTabId: 'sess-1',
    })

    const { container } = render(<ConnectionTabBar />)
    const accents = container.querySelectorAll('[class*="colorAccent"]')
    expect(accents.length).toBe(1)
  })

  it('renders a read-only padlock icon for read-only connections', () => {
    const profile = makeSavedConnection({ readOnly: true })
    const conn = makeActiveConnection({ id: 'sess-1', profile })

    useConnectionStore.setState({
      activeConnections: { 'sess-1': conn },
      activeTabId: 'sess-1',
    })

    render(<ConnectionTabBar />)
    expect(screen.getByLabelText('Read-only connection')).toBeInTheDocument()
  })

  it('does not render a read-only padlock icon for writable connections', () => {
    const profile = makeSavedConnection({ readOnly: false })
    const conn = makeActiveConnection({ id: 'sess-1', profile })

    useConnectionStore.setState({
      activeConnections: { 'sess-1': conn },
      activeTabId: 'sess-1',
    })

    render(<ConnectionTabBar />)
    expect(screen.queryByLabelText('Read-only connection')).not.toBeInTheDocument()
  })

  it('right-click (auxclick button 2) on a tab does NOT open close confirmation', async () => {
    const conn1 = makeActiveConnection({ id: 'sess-1' })
    useConnectionStore.setState({
      activeConnections: { 'sess-1': conn1 },
      activeTabId: 'sess-1',
    })

    render(<ConnectionTabBar />)

    const tab = screen.getByTestId('connection-session-tab-sess-1')
    await act(async () => {
      tab.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 2 }))
    })

    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
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

  it('renders connection tabs using explicit connection order', () => {
    const conn1 = makeActiveConnection({
      id: 'sess-1',
      profile: makeSavedConnection({ name: 'One' }),
    })
    const conn2 = makeActiveConnection({
      id: 'sess-2',
      profile: makeSavedConnection({ id: 'conn-2', name: 'Two' }),
    })
    const conn3 = makeActiveConnection({
      id: 'sess-3',
      profile: makeSavedConnection({ id: 'conn-3', name: 'Three' }),
    })

    useConnectionStore.setState({
      activeConnections: { 'sess-1': conn1, 'sess-2': conn2, 'sess-3': conn3 },
      activeConnectionOrder: ['sess-3', 'sess-1', 'sess-2'],
      activeTabId: 'sess-1',
    })

    render(<ConnectionTabBar />)

    const labels = screen.getAllByRole('button').map((el) => el.textContent ?? '')
    const compact = labels.join(' ')
    expect(compact.indexOf('Three')).toBeLessThan(compact.indexOf('One'))
    expect(compact.indexOf('One')).toBeLessThan(compact.indexOf('Two'))
  })

  it('supports pointer-driven reorder without changing active tab', async () => {
    const conn1 = makeActiveConnection({
      id: 'sess-1',
      profile: makeSavedConnection({ name: 'One' }),
    })
    const conn2 = makeActiveConnection({
      id: 'sess-2',
      profile: makeSavedConnection({ id: 'conn-2', name: 'Two' }),
    })
    const conn3 = makeActiveConnection({
      id: 'sess-3',
      profile: makeSavedConnection({ id: 'conn-3', name: 'Three' }),
    })

    useConnectionStore.setState({
      activeConnections: { 'sess-1': conn1, 'sess-2': conn2, 'sess-3': conn3 },
      activeConnectionOrder: ['sess-1', 'sess-2', 'sess-3'],
      activeTabId: 'sess-1',
    })

    render(<ConnectionTabBar />)

    const from = screen.getByTestId('connection-session-tab-sess-3')
    const to = screen.getByTestId('connection-session-tab-sess-1')
    vi.spyOn(to, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      width: 100,
      right: 200,
      top: 0,
      bottom: 30,
      height: 30,
      x: 100,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect)

    fireEvent.pointerDown(from, { button: 0, clientX: 280, clientY: 15 })
    fireEvent.pointerMove(window, { clientX: 198, clientY: 15 })
    await waitFor(() => expect(from.className).toContain('dragging'))
    fireEvent.pointerUp(window, { clientX: 198, clientY: 15 })

    expect(useConnectionStore.getState().activeConnectionOrder).toEqual([
      'sess-1',
      'sess-3',
      'sess-2',
    ])
    expect(useConnectionStore.getState().activeTabId).toBe('sess-1')
  })

  it('does not initiate pointer reorder from the close button', () => {
    const conn1 = makeActiveConnection({
      id: 'sess-1',
      profile: makeSavedConnection({ name: 'One' }),
    })
    const conn2 = makeActiveConnection({
      id: 'sess-2',
      profile: makeSavedConnection({ id: 'conn-2', name: 'Two' }),
    })

    useConnectionStore.setState({
      activeConnections: { 'sess-1': conn1, 'sess-2': conn2 },
      activeConnectionOrder: ['sess-1', 'sess-2'],
      activeTabId: 'sess-1',
    })

    render(<ConnectionTabBar />)

    const close = screen.getByLabelText('Close Two')
    fireEvent.pointerDown(close, { button: 0, clientX: 210, clientY: 15 })
    fireEvent.pointerMove(window, { clientX: 120, clientY: 15 })
    fireEvent.pointerUp(window, { clientX: 120, clientY: 15 })

    expect(useConnectionStore.getState().activeConnectionOrder).toEqual(['sess-1', 'sess-2'])
  })

  it('starts pointer reorder from the connection tab container body (not only label hotspot)', async () => {
    const conn1 = makeActiveConnection({
      id: 'sess-1',
      profile: makeSavedConnection({ name: 'One' }),
    })
    const conn2 = makeActiveConnection({
      id: 'sess-2',
      profile: makeSavedConnection({ id: 'conn-2', name: 'Two' }),
    })
    useConnectionStore.setState({
      activeConnections: { 'sess-1': conn1, 'sess-2': conn2 },
      activeConnectionOrder: ['sess-1', 'sess-2'],
      activeTabId: 'sess-1',
    })

    render(<ConnectionTabBar />)
    const tab = screen.getByTestId('connection-session-tab-sess-1')
    const targetTab = screen.getByTestId('connection-session-tab-sess-2')
    vi.spyOn(targetTab, 'getBoundingClientRect').mockReturnValue({
      left: 220,
      width: 100,
      right: 320,
      top: 0,
      bottom: 30,
      height: 30,
      x: 220,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect)

    fireEvent.pointerDown(tab, { button: 0, clientX: 180, clientY: 15 })
    fireEvent.pointerMove(window, { clientX: 222, clientY: 15 })

    await waitFor(() => expect(tab.className).toContain('dragging'))
    fireEvent.pointerUp(window, { clientX: 222, clientY: 15 })

    expect(useConnectionStore.getState().activeConnectionOrder).toEqual(['sess-1', 'sess-2'])
  })

  it('opens context menu from right-click and supports move actions', async () => {
    const user = userEvent.setup()
    const conn1 = makeActiveConnection({
      id: 'sess-1',
      profile: makeSavedConnection({ name: 'One' }),
    })
    const conn2 = makeActiveConnection({
      id: 'sess-2',
      profile: makeSavedConnection({ id: 'conn-2', name: 'Two' }),
    })

    useConnectionStore.setState({
      activeConnections: { 'sess-1': conn1, 'sess-2': conn2 },
      activeConnectionOrder: ['sess-1', 'sess-2'],
      activeTabId: 'sess-1',
    })

    render(<ConnectionTabBar />)

    fireEvent.contextMenu(screen.getByTestId('connection-session-tab-sess-2'), {
      clientX: 40,
      clientY: 50,
    })
    expect(screen.getByTestId('tab-context-menu')).toBeInTheDocument()

    await user.click(screen.getByTestId('tab-context-menu-item-move-left'))
    expect(useConnectionStore.getState().activeConnectionOrder).toEqual(['sess-2', 'sess-1'])

    fireEvent.contextMenu(screen.getByTestId('connection-session-tab-sess-2'), {
      clientX: 40,
      clientY: 50,
    })
    await user.click(screen.getByTestId('tab-context-menu-item-move-right'))
    expect(useConnectionStore.getState().activeConnectionOrder).toEqual(['sess-1', 'sess-2'])

    fireEvent.contextMenu(screen.getByTestId('connection-session-tab-sess-1'), {
      clientX: 40,
      clientY: 50,
    })
    await user.click(screen.getByTestId('tab-context-menu-item-move-end'))
    expect(useConnectionStore.getState().activeConnectionOrder).toEqual(['sess-2', 'sess-1'])

    fireEvent.contextMenu(screen.getByTestId('connection-session-tab-sess-1'), {
      clientX: 40,
      clientY: 50,
    })
    await user.click(screen.getByTestId('tab-context-menu-item-move-start'))
    expect(useConnectionStore.getState().activeConnectionOrder).toEqual(['sess-1', 'sess-2'])
  })

  it('opens context menu with Shift+F10 and Menu key and anchors from tab rectangle', () => {
    const conn1 = makeActiveConnection({ id: 'sess-1' })

    useConnectionStore.setState({
      activeConnections: { 'sess-1': conn1 },
      activeConnectionOrder: ['sess-1'],
      activeTabId: 'sess-1',
    })

    render(<ConnectionTabBar />)

    const tab = screen.getByTestId('connection-session-tab-sess-1')
    vi.spyOn(tab, 'getBoundingClientRect').mockReturnValue({
      left: 123,
      width: 100,
      right: 223,
      top: 10,
      bottom: 34,
      height: 24,
      x: 123,
      y: 10,
      toJSON: () => ({}),
    } as DOMRect)

    fireEvent.keyDown(tab.querySelector('[role="button"]') ?? tab, { key: 'F10', shiftKey: true })
    const menu = screen.getByTestId('tab-context-menu')
    const left = Number.parseFloat(menu.style.left)
    const top = Number.parseFloat(menu.style.top)
    expect(left).toBeGreaterThanOrEqual(0)
    expect(top).toBeGreaterThanOrEqual(0)

    fireEvent.keyDown(tab.querySelector('[role="button"]') ?? tab, { key: 'ContextMenu' })
    expect(screen.getByTestId('tab-context-menu')).toBeInTheDocument()
  })

  it('restores focus to invoker tab after context-menu action, or active tab when invoker is missing', async () => {
    const user = userEvent.setup()
    const conn1 = makeActiveConnection({
      id: 'sess-1',
      profile: makeSavedConnection({ name: 'One' }),
    })
    const conn2 = makeActiveConnection({
      id: 'sess-2',
      profile: makeSavedConnection({ id: 'conn-2', name: 'Two' }),
    })

    useConnectionStore.setState({
      activeConnections: { 'sess-1': conn1, 'sess-2': conn2 },
      activeConnectionOrder: ['sess-1', 'sess-2'],
      activeTabId: 'sess-1',
    })

    render(<ConnectionTabBar />)

    const tab2 = screen.getByTestId('connection-session-tab-sess-2')
    const tab2Label = tab2.querySelector('[role="button"]') as HTMLElement
    tab2Label.focus()
    fireEvent.contextMenu(tab2, { clientX: 20, clientY: 20 })
    await user.click(screen.getByTestId('tab-context-menu-item-move-left'))
    expect(tab2Label).toHaveFocus()

    fireEvent.contextMenu(screen.getByTestId('connection-session-tab-sess-2'), {
      clientX: 20,
      clientY: 20,
    })
    act(() => {
      useConnectionStore.setState({
        activeConnections: { 'sess-1': conn1 },
        activeConnectionOrder: ['sess-1'],
        activeTabId: 'sess-1',
      })
    })
    fireEvent.keyDown(document, { key: 'Escape' })
    const tab1Label = screen
      .getByTestId('connection-session-tab-sess-1')
      .querySelector('[role="button"]') as HTMLElement
    await waitFor(() => expect(tab1Label).toHaveFocus())
  })

  it('keeps duplicate suffix ordering deterministic after reorder', () => {
    const profile = makeSavedConnection({ id: 'shared', name: 'Prod' })
    const a = makeActiveConnection({ id: 'sess-a', profile })
    const b = makeActiveConnection({ id: 'sess-b', profile })
    const c = makeActiveConnection({ id: 'sess-c', profile })

    useConnectionStore.setState({
      activeConnections: { 'sess-a': a, 'sess-b': b, 'sess-c': c },
      activeConnectionOrder: ['sess-b', 'sess-a', 'sess-c'],
      activeTabId: 'sess-b',
    })

    render(<ConnectionTabBar />)

    expect(screen.getByText(/^Prod$/)).toBeInTheDocument()
    expect(screen.getByText('Prod (2)')).toBeInTheDocument()
    expect(screen.getByText('Prod (3)')).toBeInTheDocument()
  })
})
