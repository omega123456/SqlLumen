import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SchemaInfoTab } from '../../../components/schema-info/SchemaInfoTab'
import { useWorkspaceStore, _resetTabIdCounter } from '../../../stores/workspace-store'
import type { WorkspaceTab, SchemaInfoResponse } from '../../../types/schema'

const mockGetSchemaInfo = vi.fn()

vi.mock('../../../lib/schema-commands', () => ({
  getSchemaInfo: (...args: unknown[]) => mockGetSchemaInfo(...args),
}))

function makeTab(overrides: Partial<WorkspaceTab> = {}): WorkspaceTab {
  return {
    id: 'tab-1',
    type: 'schema-info',
    label: 'users',
    connectionId: 'conn-1',
    databaseName: 'mydb',
    objectName: 'users',
    objectType: 'table',
    ...overrides,
  }
}

function makeSchemaInfoResponse(overrides: Partial<SchemaInfoResponse> = {}): SchemaInfoResponse {
  return {
    columns: [
      {
        name: 'id',
        dataType: 'bigint',
        nullable: false,
        columnKey: 'PRI',
        defaultValue: null,
        extra: 'auto_increment',
        ordinalPosition: 1,
      },
      {
        name: 'name',
        dataType: 'varchar',
        nullable: false,
        columnKey: '',
        defaultValue: null,
        extra: '',
        ordinalPosition: 2,
      },
    ],
    indexes: [
      {
        name: 'PRIMARY',
        indexType: 'BTREE',
        cardinality: 1000,
        columns: ['id'],
        isVisible: true,
        isUnique: true,
      },
    ],
    foreignKeys: [],
    ddl: 'CREATE TABLE `users` (`id` bigint NOT NULL)',
    metadata: {
      engine: 'InnoDB',
      collation: 'utf8mb4_general_ci',
      autoIncrement: 101,
      createTime: '2023-01-01',
      tableRows: 1000,
      dataLength: 16384,
      indexLength: 8192,
    },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSchemaInfo.mockReset()
  useWorkspaceStore.setState({
    tabsByConnection: {},
    activeTabByConnection: {},
  })
  _resetTabIdCounter()
})

describe('SchemaInfoTab', () => {
  it('renders loading state while fetching', () => {
    // Never resolve the promise to keep loading
    mockGetSchemaInfo.mockReturnValue(new Promise(() => {}))
    const tab = makeTab()

    render(<SchemaInfoTab tab={tab} />)

    expect(screen.getByTestId('schema-info-tab')).toBeInTheDocument()
    expect(screen.getByText('Loading schema info...')).toBeInTheDocument()
  })

  it('renders error state on fetch failure', async () => {
    mockGetSchemaInfo.mockRejectedValue(new Error('Connection failed'))
    const tab = makeTab()

    render(<SchemaInfoTab tab={tab} />)

    await waitFor(() => {
      expect(screen.getByText(/Failed to load schema info: Connection failed/)).toBeInTheDocument()
    })
  })

  it('shows correct sub-tabs for table (all 4)', async () => {
    mockGetSchemaInfo.mockResolvedValue(makeSchemaInfoResponse())
    const tab = makeTab({ objectType: 'table' })

    render(<SchemaInfoTab tab={tab} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Columns' })).toBeInTheDocument()
    })
    expect(screen.getByText('Indexes')).toBeInTheDocument()
    expect(screen.getByText('Foreign Keys')).toBeInTheDocument()
    expect(screen.getByText('DDL')).toBeInTheDocument()
  })

  it('shows correct sub-tabs for view (columns + ddl)', async () => {
    mockGetSchemaInfo.mockResolvedValue(
      makeSchemaInfoResponse({ indexes: [], foreignKeys: [], metadata: null })
    )
    const tab = makeTab({ objectType: 'view' })

    render(<SchemaInfoTab tab={tab} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Columns' })).toBeInTheDocument()
    })
    expect(screen.getByText('DDL')).toBeInTheDocument()
    expect(screen.queryByText('Indexes')).not.toBeInTheDocument()
    expect(screen.queryByText('Foreign Keys')).not.toBeInTheDocument()
  })

  it('shows correct sub-tabs for procedure (ddl only)', async () => {
    mockGetSchemaInfo.mockResolvedValue(
      makeSchemaInfoResponse({ columns: [], indexes: [], foreignKeys: [], metadata: null })
    )
    const tab = makeTab({ objectType: 'procedure' })

    render(<SchemaInfoTab tab={tab} />)

    await waitFor(() => {
      expect(screen.getByText('DDL')).toBeInTheDocument()
    })
    expect(screen.queryByText('Columns')).not.toBeInTheDocument()
    expect(screen.queryByText('Indexes')).not.toBeInTheDocument()
    expect(screen.queryByText('Foreign Keys')).not.toBeInTheDocument()
  })

  it('shows column count stat on Columns sub-tab only', async () => {
    const user = userEvent.setup()
    mockGetSchemaInfo.mockResolvedValue(makeSchemaInfoResponse())

    useWorkspaceStore.getState().openTab({
      type: 'schema-info',
      label: 'users',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'users',
      objectType: 'table',
    })
    const tab = useWorkspaceStore.getState().tabsByConnection['conn-1'][0]

    const { rerender } = render(<SchemaInfoTab tab={tab} />)

    await waitFor(() => {
      expect(screen.getByTestId('stats-columns-card')).toBeInTheDocument()
    })
    expect(screen.getByTestId('stats-columns-card')).toHaveTextContent(
      Number(2).toLocaleString()
    )

    await user.click(screen.getByRole('button', { name: 'DDL' }))

    const updatedTab = useWorkspaceStore.getState().tabsByConnection['conn-1'][0]
    rerender(<SchemaInfoTab tab={updatedTab} />)

    expect(screen.queryByTestId('stats-columns-card')).not.toBeInTheDocument()
  })

  it('renders stats row for tables, not for other types', async () => {
    mockGetSchemaInfo.mockResolvedValue(makeSchemaInfoResponse())
    const tableTab = makeTab({ objectType: 'table' })

    const { unmount } = render(<SchemaInfoTab tab={tableTab} />)

    await waitFor(() => {
      expect(screen.getByTestId('stats-row')).toBeInTheDocument()
    })

    unmount()

    mockGetSchemaInfo.mockResolvedValue(
      makeSchemaInfoResponse({ columns: [], indexes: [], foreignKeys: [], metadata: null })
    )
    const viewTab = makeTab({ id: 'tab-view', objectType: 'view' })

    render(<SchemaInfoTab tab={viewTab} />)

    await waitFor(() => {
      expect(screen.getByTestId('schema-info-tab')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('stats-row')).not.toBeInTheDocument()
  })

  it('clicking sub-tab changes active sub-tab in store', async () => {
    const user = userEvent.setup()
    mockGetSchemaInfo.mockResolvedValue(makeSchemaInfoResponse())

    // Set up the tab in the workspace store to track sub-tab changes
    useWorkspaceStore.getState().openTab({
      type: 'schema-info',
      label: 'users',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'users',
      objectType: 'table',
    })

    const tabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    const tab = tabs[0]

    render(<SchemaInfoTab tab={tab} />)

    await waitFor(() => {
      expect(screen.getByText('DDL')).toBeInTheDocument()
    })

    await user.click(screen.getByText('DDL'))

    const updatedTabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    expect(updatedTabs[0].subTabId).toBe('ddl')
  })

  it('calls getSchemaInfo with correct args on mount', async () => {
    mockGetSchemaInfo.mockResolvedValue(makeSchemaInfoResponse())
    const tab = makeTab({
      connectionId: 'conn-2',
      databaseName: 'testdb',
      objectName: 'orders',
      objectType: 'view',
    })

    render(<SchemaInfoTab tab={tab} />)

    await waitFor(() => {
      expect(mockGetSchemaInfo).toHaveBeenCalledWith('conn-2', 'testdb', 'orders', 'view')
    })
  })
})
