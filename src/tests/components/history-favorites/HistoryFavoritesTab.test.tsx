import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import { HistoryFavoritesTab } from '../../../components/history-favorites/HistoryFavoritesTab'
import { useConnectionStore } from '../../../stores/connection-store'
import { useHistoryStore } from '../../../stores/history-store'
import { useFavoritesStore } from '../../../stores/favorites-store'
import type { ActiveConnection, SavedConnection } from '../../../types/connection'
import type { HistoryFavoritesTab as HistoryFavoritesTabType } from '../../../types/schema'

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

function makeActiveConnection(overrides: Partial<ActiveConnection> = {}): ActiveConnection {
  return {
    id: 'conn-1',
    profile: makeSavedConnection(),
    status: 'connected',
    serverVersion: '8.0.35',
    ...overrides,
  }
}

const TAB: HistoryFavoritesTabType = {
  id: 'tab-1',
  type: 'history-favorites',
  label: 'History & Favorites',
  connectionId: 'conn-1',
}

let consoleSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  useHistoryStore.setState({
    entriesByConnection: {},
    totalByConnection: {},
    pageByConnection: {},
    searchByConnection: {},
    isLoadingByConnection: {},
    errorByConnection: {},
    pageSize: 50,
  })
  useFavoritesStore.setState({
    entries: [],
    isLoading: false,
    error: null,
    connectionId: null,
    dialogOpen: false,
    editingFavorite: null,
  })
  useConnectionStore.setState({
    activeConnections: {},
    activeTabId: null,
    dialogOpen: false,
    error: null,
  })
  vi.clearAllMocks()

  mockIPC((cmd) => {
    switch (cmd) {
      case 'list_history':
        return { entries: [], total: 0, page: 1, pageSize: 50 }
      case 'list_favorites':
        return []
      case 'log_frontend':
        return undefined
      default:
        return null
    }
  })
})

afterEach(() => {
  consoleSpy?.mockRestore()
})

describe('HistoryFavoritesTab', () => {
  it('shows "No active connection" when connection is absent', () => {
    render(<HistoryFavoritesTab tab={TAB} />)
    expect(screen.getByText('No active connection')).toBeInTheDocument()
    expect(screen.getByTestId('history-favorites-tab')).toBeInTheDocument()
  })

  it('renders both History and Favorites panels simultaneously when connected', async () => {
    const conn = makeActiveConnection()
    useConnectionStore.setState({
      activeConnections: { 'conn-1': conn },
      activeTabId: 'conn-1',
    })

    render(<HistoryFavoritesTab tab={TAB} />)

    await waitFor(() => {
      expect(screen.getByTestId('history-panel')).toBeInTheDocument()
    })
    expect(screen.getByTestId('favorites-panel')).toBeInTheDocument()
  })

  it('shows both panels visible at the same time (no toggle)', async () => {
    const conn = makeActiveConnection()
    useConnectionStore.setState({
      activeConnections: { 'conn-1': conn },
      activeTabId: 'conn-1',
    })

    render(<HistoryFavoritesTab tab={TAB} />)

    await waitFor(() => {
      expect(screen.getByTestId('history-panel')).toBeInTheDocument()
      expect(screen.getByTestId('favorites-panel')).toBeInTheDocument()
    })

    // No toggle buttons should exist
    expect(screen.queryByTestId('history-panel-tab')).not.toBeInTheDocument()
    expect(screen.queryByTestId('favorites-panel-tab')).not.toBeInTheDocument()
  })

  it('loads history and favorites on mount', async () => {
    const conn = makeActiveConnection()
    useConnectionStore.setState({
      activeConnections: { 'conn-1': conn },
      activeTabId: 'conn-1',
    })

    const loadHistorySpy = vi.fn()
    const loadFavoritesSpy = vi.fn()
    useHistoryStore.setState({ loadHistory: loadHistorySpy })
    useFavoritesStore.setState({ loadFavorites: loadFavoritesSpy })

    render(<HistoryFavoritesTab tab={TAB} />)

    await waitFor(() => {
      expect(loadHistorySpy).toHaveBeenCalledWith('conn-1')
      expect(loadFavoritesSpy).toHaveBeenCalledWith('conn-1')
    })
  })
})
