import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from '../../../components/layout/Sidebar'
import { useConnectionStore } from '../../../stores/connection-store'
import { useSchemaStore } from '../../../stores/schema-store'
import { makeActiveConnection } from '../../helpers/connection-test-utils'

beforeEach(() => {
  useConnectionStore.setState({
    activeConnections: {},
    activeTabId: null,
    dialogOpen: false,
    error: null,
  })
  // Mock loadDatabases to prevent real IPC calls in tests
  useSchemaStore.setState({
    connectionStates: {},
    revealRequest: null,
    loadDatabases: vi.fn().mockResolvedValue(undefined),
  })
})

describe('Sidebar', () => {
  it('renders the empty state message when no active connection', () => {
    render(<Sidebar />)
    expect(screen.getByText('No active connection')).toBeInTheDocument()
  })

  it('renders data-testid="sidebar-inner"', () => {
    render(<Sidebar />)
    expect(screen.getByTestId('sidebar-inner')).toBeInTheDocument()
  })

  it('renders ObjectBrowser when connected', () => {
    useConnectionStore.setState({
      activeConnections: { 'conn-1': makeActiveConnection() },
      activeTabId: 'conn-1',
    })

    render(<Sidebar />)
    expect(screen.getByTestId('object-browser')).toBeInTheDocument()
  })

  it('shows ObjectBrowser when connection is disconnected (preserves context)', () => {
    useConnectionStore.setState({
      activeConnections: {
        'conn-1': makeActiveConnection({ status: 'disconnected' }),
      },
      activeTabId: 'conn-1',
    })

    render(<Sidebar />)
    expect(screen.getByTestId('object-browser')).toBeInTheDocument()
  })

  it('switches from favourites back to the tree when a reveal is requested', async () => {
    const user = userEvent.setup()
    useConnectionStore.setState({
      activeConnections: { 'conn-1': makeActiveConnection() },
      activeTabId: 'conn-1',
    })

    render(<Sidebar />)
    await user.click(screen.getByTestId('favourites-toggle'))
    expect(await screen.findByTestId('favourites-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('filter-input')).not.toBeInTheDocument()

    act(() => {
      useSchemaStore.getState().requestReveal('conn-1', 'table:x:y')
    })

    expect(await screen.findByTestId('filter-input')).toBeInTheDocument()

    // Favourites can still be reopened after a reveal
    await user.click(screen.getByTestId('favourites-toggle'))
    expect(await screen.findByTestId('favourites-empty')).toBeInTheDocument()
  })

  it('keeps favourites open when a reveal is requested for another connection', async () => {
    const user = userEvent.setup()
    useConnectionStore.setState({
      activeConnections: { 'conn-1': makeActiveConnection() },
      activeTabId: 'conn-1',
    })

    render(<Sidebar />)
    await user.click(screen.getByTestId('favourites-toggle'))
    expect(await screen.findByTestId('favourites-empty')).toBeInTheDocument()

    act(() => {
      useSchemaStore.getState().requestReveal('conn-2', 'table:x:y')
    })

    expect(screen.getByTestId('favourites-empty')).toBeInTheDocument()
  })
})
