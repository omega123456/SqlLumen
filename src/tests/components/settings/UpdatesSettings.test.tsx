import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { mockGetAppInfo, mockLogFrontend } = vi.hoisted(() => ({
  mockGetAppInfo: vi.fn(),
  mockLogFrontend: vi.fn(),
}))

vi.mock('../../../lib/app-info-commands', () => ({
  getAppInfo: mockGetAppInfo,
}))

vi.mock('../../../lib/app-log-commands', () => ({
  logFrontend: mockLogFrontend,
}))

import { UpdatesSettings } from '../../../components/settings/UpdatesSettings'
import { useConnectionStore } from '../../../stores/connection-store'
import { useObjectEditorStore } from '../../../stores/object-editor-store'
import { useQueryStore } from '../../../stores/query-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useTableDataStore } from '../../../stores/table-data-store'
import { useTableDesignerStore } from '../../../stores/table-designer-store'
import { useUpdateStore } from '../../../stores/update-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'

const mockCheckForUpdate = vi.fn<(manual: boolean) => Promise<void>>()
const mockDownloadAndInstall = vi.fn<() => Promise<void>>()

function resetStores(): void {
  useSettingsStore.setState({
    settings: { 'updates.checkInterval': '1d' },
    pendingChanges: {},
    isLoading: false,
    isDirty: false,
    activeSection: 'updates',
    isDialogOpen: false,
    dialogSection: undefined,
  })

  useUpdateStore.setState({
    status: 'idle',
    availableVersion: null,
    downloadProgress: 0,
    errorMessage: null,
    checkForUpdate: mockCheckForUpdate,
    downloadAndInstall: mockDownloadAndInstall,
  })

  useConnectionStore.setState({
    activeConnections: {},
    activeTabId: null,
    dialogOpen: false,
    error: null,
  })
  useWorkspaceStore.setState({ tabsByConnection: {}, activeTabByConnection: {} })
  useQueryStore.setState({ tabs: {} })
  useTableDataStore.setState({ tabs: {} })
  useTableDesignerStore.setState({ tabs: {} })
  useObjectEditorStore.setState({ tabs: {} })
}

describe('UpdatesSettings', () => {
  beforeEach(() => {
    resetStores()
    mockCheckForUpdate.mockReset()
    mockDownloadAndInstall.mockReset().mockResolvedValue(undefined)
    mockGetAppInfo.mockReset().mockResolvedValue({
      rustLogOverride: false,
      logDirectory: '/mock/logs',
      appVersion: '1.2.3',
    })
    mockLogFrontend.mockReset()
  })

  it('renders idle state with Check for Updates button', async () => {
    render(<UpdatesSettings />)

    expect(await screen.findByTestId('updates-app-version')).toHaveTextContent('1.2.3')
    expect(screen.getByTestId('updates-check-button')).toHaveTextContent('Check for Updates')
  })

  it('renders checking state with disabled button', async () => {
    useUpdateStore.setState({ status: 'checking' })
    render(<UpdatesSettings />)
    await screen.findByTestId('updates-app-version')
    expect(screen.getByTestId('updates-checking-button')).toBeDisabled()
  })

  it('renders up-to-date state', async () => {
    useUpdateStore.setState({ status: 'up-to-date' })
    render(<UpdatesSettings />)
    await screen.findByTestId('updates-app-version')
    expect(screen.getByTestId('updates-up-to-date')).toHaveTextContent("You're up to date")
  })

  it('renders available state with version and Download & Restart button', async () => {
    useUpdateStore.setState({ status: 'available', availableVersion: '2.0.0' })
    render(<UpdatesSettings />)
    await screen.findByTestId('updates-app-version')
    expect(screen.getByTestId('updates-available-card')).toHaveTextContent(
      'Version 2.0.0 is available'
    )
    expect(screen.getByTestId('updates-download-button')).toHaveTextContent('Download & Restart')
  })

  it('renders installing state with progress bar and percentage', async () => {
    useUpdateStore.setState({
      status: 'installing',
      availableVersion: '2.0.0',
      downloadProgress: 42,
    })
    render(<UpdatesSettings />)
    await screen.findByTestId('updates-app-version')
    expect(screen.getByTestId('updates-installing-card')).toHaveTextContent(
      'Downloading version 2.0.0'
    )
    expect(screen.getByTestId('updates-progress-text')).toHaveTextContent('42%')
  })

  it('renders error state with Try Again button', async () => {
    useUpdateStore.setState({ status: 'error', errorMessage: 'network down' })
    render(<UpdatesSettings />)
    await screen.findByTestId('updates-app-version')
    expect(screen.getByTestId('updates-error-state')).toHaveTextContent('network down')
    expect(screen.getByTestId('updates-try-again-button')).toHaveTextContent('Try Again')
  })

  it('shows confirmation dialog before Download & Restart when active work exists', async () => {
    const user = userEvent.setup()
    useUpdateStore.setState({ status: 'available', availableVersion: '2.0.0' })
    useConnectionStore.setState({
      activeConnections: {
        conn1: {
          id: 'conn1',
          profile: {
            id: 'profile-1',
            name: 'Test',
            host: '127.0.0.1',
            port: 3306,
            username: 'root',
            hasPassword: true,
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
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:00:00Z',
          },
          sessionDatabase: null,
          status: 'connected',
          serverVersion: '8.0.0',
        },
      },
    })

    render(<UpdatesSettings />)
    await user.click(screen.getByTestId('updates-download-button'))

    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
    expect(screen.getByText('Download & Restart?')).toBeInTheDocument()
    expect(screen.getByText(/1 active database connection/)).toBeInTheDocument()

    await user.click(screen.getByTestId('confirm-confirm-button'))
    await waitFor(() => {
      expect(mockDownloadAndInstall).toHaveBeenCalledTimes(1)
    })
  })

  it('skips confirmation dialog when no active work exists', async () => {
    const user = userEvent.setup()
    useUpdateStore.setState({ status: 'available', availableVersion: '2.0.0' })

    render(<UpdatesSettings />)
    await user.click(screen.getByTestId('updates-download-button'))

    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
    expect(mockDownloadAndInstall).toHaveBeenCalledTimes(1)
  })

  it('check interval dropdown updates pendingChanges', async () => {
    const user = userEvent.setup()
    render(<UpdatesSettings />)

    await user.click(screen.getByTestId('settings-updates-check-interval'))
    await user.click(screen.getByRole('option', { name: 'Every 5 hours' }))

    expect(useSettingsStore.getState().pendingChanges['updates.checkInterval']).toBe('5h')
  })

  it('version display shows app info version', async () => {
    render(<UpdatesSettings />)
    expect(await screen.findByTestId('updates-app-version')).toHaveTextContent('1.2.3')
  })
})
