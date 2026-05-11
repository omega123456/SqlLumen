import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { mockGetAppInfo, mockLogFrontend, mockHasTauriApis } = vi.hoisted(() => ({
  mockGetAppInfo: vi.fn(),
  mockLogFrontend: vi.fn(),
  mockHasTauriApis: vi.fn(),
}))

vi.mock('../../../lib/app-info-commands', () => ({
  getAppInfo: mockGetAppInfo,
}))

vi.mock('../../../lib/app-log-commands', () => ({
  logFrontend: mockLogFrontend,
}))

vi.mock('../../../lib/tauri-env', () => ({
  hasTauriApis: mockHasTauriApis,
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
import type { ObjectEditorTab, TableDataTab, TableDesignerTab } from '../../../types/schema'

const mockCheckForUpdate = vi.fn<(manual: boolean) => Promise<void>>()
const mockDownloadAndInstall = vi.fn<() => Promise<void>>()
const mockRestartApp = vi.fn<() => Promise<void>>()

function makeAvailableUpdate(version = '2.0.0') {
  return {
    status: 'available' as const,
    availableVersion: version,
  }
}

function setReadyToFinishState(version: string, platform: 'windows' | 'linux' | 'macos'): void {
  const isLinux = platform === 'linux'
  useUpdateStore.setState({
    status: 'ready-to-finish',
    currentPlatform: platform,
    readyToFinishAction: isLinux ? 'manual-quit' : 'relaunch',
    readyToFinishCta: isLinux ? 'Got it' : 'Restart App',
    readyToFinishMessage: isLinux
      ? `Quit and reopen SqlLumen to finish installing version ${version}.`
      : `Restart SqlLumen to finish installing version ${version}.`,
    availableVersion: version,
  })
}

function makeActiveConnections(count: number) {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => {
      const id = `conn${index + 1}`
      return [
        id,
        {
          id,
          profile: {
            id: `profile-${index + 1}`,
            name: `Test ${index + 1}`,
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
            sortOrder: index,
            connectTimeoutSecs: 10,
            keepaliveIntervalSecs: 60,
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:00:00Z',
          },
          sessionDatabase: null,
          status: 'connected' as const,
          serverVersion: '8.0.0',
        },
      ]
    })
  )
}

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
    currentPlatform: 'windows',
    readyToFinishAction: 'relaunch',
    readyToFinishCta: 'Restart App',
    readyToFinishMessage: 'Restart SqlLumen to finish installing version the latest version.',
    availableVersion: null,
    downloadProgress: 0,
    errorMessage: null,
    checkForUpdate: mockCheckForUpdate,
    downloadAndInstall: mockDownloadAndInstall,
    restartApp: mockRestartApp,
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
    mockRestartApp.mockReset().mockResolvedValue(undefined)
    mockGetAppInfo.mockReset().mockResolvedValue({
      rustLogOverride: false,
      logDirectory: '/mock/logs',
      appVersion: '1.2.3',
    })
    mockLogFrontend.mockReset()
    mockHasTauriApis.mockReset().mockReturnValue(true)
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

  it('renders available state with version and Download Update button', async () => {
    useUpdateStore.setState(makeAvailableUpdate())
    render(<UpdatesSettings />)
    await screen.findByTestId('updates-app-version')
    expect(screen.getByTestId('updates-available-card')).toHaveTextContent(
      'Version 2.0.0 is available'
    )
    expect(screen.getByTestId('updates-download-button')).toHaveTextContent('Download Update')
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
    expect(screen.getByTestId('updates-installing-card')).toHaveTextContent('Downloading update')
    expect(screen.getByTestId('updates-installing-card')).not.toHaveTextContent('Preparing restart')
    expect(screen.getByTestId('updates-progress-text')).toHaveTextContent('42%')
  })

  it.each([
    {
      platform: 'windows',
      expectedTitle: 'Update downloaded',
      expectedMessage: 'Restart SqlLumen to finish installing version 2.0.0.',
      expectedButton: 'Restart App',
    },
    {
      platform: 'linux',
      expectedTitle: 'Restart required',
      expectedMessage: 'Quit and reopen SqlLumen to finish installing version 2.0.0.',
      expectedButton: 'Got it',
    },
  ] as const)(
    'renders ready-to-finish state for $platform',
    async ({ platform, expectedTitle, expectedMessage, expectedButton }) => {
      setReadyToFinishState('2.0.0', platform)

      render(<UpdatesSettings />)

      await screen.findByTestId('updates-app-version')
      expect(screen.getByTestId('updates-ready-card')).toHaveTextContent(expectedTitle)
      expect(screen.getByTestId('updates-ready-message')).toHaveTextContent(expectedMessage)
      expect(screen.getByTestId('updates-restart-button')).toHaveTextContent(expectedButton)
      if (platform === 'windows') {
        expect(screen.getByTestId('updates-later-button')).toHaveTextContent('Later')
      }
    }
  )

  it('renders restart error while keeping ready-to-finish actions visible', async () => {
    setReadyToFinishState('2.0.0', 'windows')
    useUpdateStore.setState({ errorMessage: 'restart failed' })

    render(<UpdatesSettings />)

    await screen.findByTestId('updates-app-version')
    expect(screen.getByTestId('updates-ready-error')).toHaveTextContent(
      'Restart failed: restart failed'
    )
    expect(screen.getByTestId('updates-restart-button')).toHaveTextContent('Restart App')
  })

  it('renders error state with Try Again button', async () => {
    useUpdateStore.setState({ status: 'error', errorMessage: 'network down' })
    render(<UpdatesSettings />)
    await screen.findByTestId('updates-app-version')
    expect(screen.getByTestId('updates-error-state')).toHaveTextContent('network down')
    expect(screen.getByTestId('updates-try-again-button')).toHaveTextContent('Try Again')
  })

  it('manual check button triggers a manual update check from idle state', async () => {
    const user = userEvent.setup()
    render(<UpdatesSettings />)

    await user.click(await screen.findByTestId('updates-check-button'))

    expect(mockCheckForUpdate).toHaveBeenCalledWith(true)
  })

  it('try again button triggers a manual update check from error state', async () => {
    const user = userEvent.setup()
    useUpdateStore.setState({ status: 'error', errorMessage: 'network down' })

    render(<UpdatesSettings />)

    await user.click(await screen.findByTestId('updates-try-again-button'))

    expect(mockCheckForUpdate).toHaveBeenCalledWith(true)
  })

  it('shows unavailable app version and logs when app info loading fails', async () => {
    mockGetAppInfo.mockRejectedValueOnce(new Error('boom'))

    render(<UpdatesSettings />)

    expect(await screen.findByTestId('updates-app-version')).toHaveTextContent('Unavailable')
    expect(mockLogFrontend).toHaveBeenCalledWith(
      'error',
      expect.stringContaining('Failed to load app version')
    )
  })

  it('shows confirmation dialog before download when active work exists', async () => {
    const user = userEvent.setup()
    useUpdateStore.setState(makeAvailableUpdate())
    useConnectionStore.setState({ activeConnections: makeActiveConnections(1) })

    render(<UpdatesSettings />)
    await user.click(screen.getByTestId('updates-download-button'))

    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
    expect(screen.getByText('Download update?')).toBeInTheDocument()
    expect(screen.getByText(/1 active database connection/)).toBeInTheDocument()

    await user.click(screen.getByTestId('confirm-confirm-button'))
    await waitFor(() => {
      expect(mockDownloadAndInstall).toHaveBeenCalledTimes(1)
    })
  })

  it('skips confirmation dialog when no active work exists', async () => {
    const user = userEvent.setup()
    useUpdateStore.setState(makeAvailableUpdate())

    render(<UpdatesSettings />)
    await user.click(screen.getByTestId('updates-download-button'))

    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
    expect(mockDownloadAndInstall).toHaveBeenCalledTimes(1)
  })

  it('shows restart confirmation before restarting on Windows when active work exists', async () => {
    const user = userEvent.setup()
    setReadyToFinishState('2.0.0', 'windows')
    useConnectionStore.setState({ activeConnections: makeActiveConnections(1) })

    render(<UpdatesSettings />)
    await screen.findByTestId('updates-app-version')
    await user.click(screen.getByTestId('updates-restart-button'))

    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
    expect(screen.getByText('Restart App?')).toBeInTheDocument()

    await user.click(screen.getByTestId('confirm-confirm-button'))
    await waitFor(() => {
      expect(mockRestartApp).toHaveBeenCalledTimes(1)
    })
  })

  it('restarts immediately on Windows when no active work exists', async () => {
    const user = userEvent.setup()
    setReadyToFinishState('2.0.0', 'windows')

    render(<UpdatesSettings />)
    await user.click(await screen.findByTestId('updates-restart-button'))

    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
    expect(mockRestartApp).toHaveBeenCalledTimes(1)
  })

  it('linux ready-to-finish restart button does not relaunch', async () => {
    const user = userEvent.setup()
    useSettingsStore.setState({
      settings: { 'updates.checkInterval': '1d' },
      pendingChanges: {},
      isLoading: false,
      isDirty: false,
      activeSection: 'updates',
      isDialogOpen: true,
      dialogSection: 'updates',
    })
    setReadyToFinishState('2.0.0', 'linux')

    render(<UpdatesSettings />)
    await screen.findByTestId('updates-app-version')
    await user.click(screen.getByTestId('updates-restart-button'))

    expect(mockRestartApp).not.toHaveBeenCalled()
    expect(useSettingsStore.getState().isDialogOpen).toBe(false)
  })

  it('lists running queries and unsaved workspace work in the confirmation dialog', async () => {
    const user = userEvent.setup()
    useUpdateStore.setState(makeAvailableUpdate())
    useConnectionStore.setState({ activeConnections: makeActiveConnections(2) })
    useQueryStore.setState({
      tabs: {
        'query-1': {
          content: '',
          selectedText: '',
          filePath: null,
          tabStatus: 'running',
          prevTabStatus: 'idle',
          cursorPosition: null,
          connectionId: 'conn-1',
          results: [
            {
              resultStatus: 'running',
              columns: [],
              rows: [],
              totalRows: 0,
              executionTimeMs: 0,
              affectedRows: 0,
              queryId: 'q1',
              currentPage: 1,
              totalPages: 1,
              pageSize: 100,
              autoLimitApplied: false,
              errorMessage: null,
              viewMode: 'grid',
              sortColumn: null,
              sortDirection: null,
              selectedRowIndex: null,
              exportDialogOpen: false,
              lastExecutedSql: 'select 1',
              reExecutable: true,
              isAnalyzed: false,
              selectedCell: null,
              filterModel: [],
              unfilteredRows: null,
              editMode: null,
              editTableMetadata: {},
              editForeignKeys: [],
              editState: null,
              isAnalyzingQuery: false,
              editableColumnMap: new Map(),
              editColumnBindings: new Map(),
              editBoundColumnIndexMap: new Map(),
              saveError: null,
              isStale: false,
              editConnectionId: null,
              editingRowIndex: null,
            },
          ],
          activeResultIndex: 0,
          pendingNavigationAction: null,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
        },
        'query-2': {
          content: '',
          selectedText: '',
          filePath: null,
          tabStatus: 'success',
          prevTabStatus: 'idle',
          cursorPosition: null,
          connectionId: 'conn-1',
          results: [
            {
              resultStatus: 'success',
              columns: [],
              rows: [],
              totalRows: 1,
              executionTimeMs: 0,
              affectedRows: 0,
              queryId: 'q2',
              currentPage: 1,
              totalPages: 1,
              pageSize: 100,
              autoLimitApplied: false,
              errorMessage: null,
              viewMode: 'grid',
              sortColumn: null,
              sortDirection: null,
              selectedRowIndex: null,
              exportDialogOpen: false,
              lastExecutedSql: 'select 2',
              reExecutable: true,
              isAnalyzed: false,
              selectedCell: null,
              filterModel: [],
              unfilteredRows: null,
              editMode: 'users',
              editTableMetadata: {},
              editForeignKeys: [],
              editState: {
                rowKey: { id: 1 },
                originalValues: { id: 1, name: 'Alice' },
                currentValues: { id: 1, name: 'Alicia' },
                modifiedColumns: new Set(['name']),
                isNewRow: false,
              },
              isAnalyzingQuery: false,
              editableColumnMap: new Map(),
              editColumnBindings: new Map(),
              editBoundColumnIndexMap: new Map(),
              saveError: null,
              isStale: false,
              editConnectionId: 'conn-1',
              editingRowIndex: 0,
            },
          ],
          activeResultIndex: 0,
          pendingNavigationAction: null,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
        },
      },
    })

    useWorkspaceStore.setState({
      tabsByConnection: {
        'conn-1': [
          {
            id: 'table-tab',
            type: 'table-data',
            label: 'users',
            connectionId: 'conn-1',
            databaseName: 'db',
            objectName: 'users',
            objectType: 'table',
          } as TableDataTab,
          {
            id: 'designer-tab',
            type: 'table-designer',
            label: 'orders',
            connectionId: 'conn-1',
            databaseName: 'db',
            objectName: 'orders',
            mode: 'alter',
          } as TableDesignerTab,
          {
            id: 'object-tab',
            type: 'object-editor',
            label: 'View: v_users',
            connectionId: 'conn-1',
            databaseName: 'db',
            objectName: 'v_users',
            objectType: 'view',
            mode: 'alter',
          } as ObjectEditorTab,
        ],
      },
      activeTabByConnection: { 'conn-1': 'table-tab' },
    })

    useTableDataStore.setState({
      tabs: {
        'table-tab': {
          columns: [],
          rows: [],
          currentPage: 1,
          pageSize: 100,
          primaryKey: null,
          executionTimeMs: 0,
          connectionId: 'conn-1',
          database: 'db',
          table: 'users',
          editState: {
            rowKey: { id: 1 },
            originalValues: { id: 1 },
            currentValues: { id: 1, name: 'Changed' },
            modifiedColumns: new Set(['name']),
            isNewRow: false,
          },
          viewMode: 'grid',
          selectedRowKey: null,
          selectedCell: null,
          filterModel: [],
          sort: null,
          isLoading: false,
          error: null,
          saveError: null,
          isExportDialogOpen: false,
          scrollTop: 0,
          scrollLeft: 0,
          pendingNavigationAction: null,
        },
      },
    })

    useTableDesignerStore.setState({
      tabs: {
        'designer-tab': {
          connectionId: 'conn-1',
          databaseName: 'db',
          objectName: 'orders',
          mode: 'alter',
          originalSchema: null,
          currentSchema: {
            tableName: 'orders',
            columns: [],
            indexes: [],
            foreignKeys: [],
            properties: {
              engine: 'InnoDB',
              charset: 'utf8mb4',
              collation: 'utf8mb4_unicode_ci',
              autoIncrement: null,
              rowFormat: 'DEFAULT',
              comment: '',
            },
          },
          isDirty: true,
          isLoading: false,
          loadError: null,
          ddl: '',
          ddlWarnings: [],
          isDdlLoading: false,
          ddlError: null,
          validationErrors: {},
          pendingNavigationAction: null,
          selectedSubTab: 'columns',
        },
      },
    })

    useObjectEditorStore.setState({
      tabs: {
        'object-tab': {
          connectionId: 'conn-1',
          database: 'db',
          objectName: 'v_users',
          objectType: 'view',
          mode: 'alter',
          content: 'changed',
          originalContent: 'original',
          isLoading: false,
          isSaving: false,
          error: null,
          pendingNavigationAction: null,
          savedObjectName: null,
        },
      },
    })

    render(<UpdatesSettings />)
    await user.click(await screen.findByTestId('updates-download-button'))

    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
    expect(screen.getByText(/2 active database connections/)).toBeInTheDocument()
    expect(screen.getByText(/1 running query/)).toBeInTheDocument()
    expect(screen.getByText(/4 unsaved tabs/)).toBeInTheDocument()
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
