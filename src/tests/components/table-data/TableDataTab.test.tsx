import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { tableSurfaceRef, useTableDataStore } from '../../../stores/table-data-store'
import { useConnectionStore } from '../../../stores/connection-store'
import { openExportDialog } from '../../../stores/data-view/view-actions'
import { updateView } from '../../../stores/data-view/route-registry'
import { ipc } from '../../ipc-mock'
import {
  setupTestConnection,
  tablePageResponse,
  type TablePageFixture,
} from '../../helpers/table-data-test-utils'
import { makeTableColumnMeta } from '../../helpers/column-meta-fixtures'
import { TableDataTab } from '../../../components/table-data/TableDataTab'
import type { TableDataTab as TableDataTabType } from '../../../types/schema'

const TAB_ID = 'tab-1'

function makeTab(overrides: Partial<TableDataTabType> = {}): TableDataTabType {
  return {
    id: TAB_ID,
    type: 'table-data',
    label: 'users',
    connectionId: 'conn-1',
    databaseName: 'mydb',
    objectName: 'users',
    objectType: 'table',
    ...overrides,
  }
}

const KEYED_PAGE: TablePageFixture = {
  columns: [
    makeTableColumnMeta({
      name: 'id',
      dataType: 'bigint',
      isPrimaryKey: true,
      isNullable: false,
      isAutoIncrement: true,
    }),
    makeTableColumnMeta({ name: 'name', dataType: 'varchar', isNullable: true }),
  ],
  rows: [
    [1, 'Alice'],
    [2, 'Bob'],
  ],
  primaryKey: { keyColumns: ['id'], hasAutoIncrement: true, isUniqueKeyFallback: false },
}

const KEYLESS_PAGE: TablePageFixture = {
  columns: [makeTableColumnMeta({ name: 'id', dataType: 'bigint', isNullable: false })],
  rows: [[1]],
  primaryKey: null,
}

function servePage(page: TablePageFixture) {
  ipc.overridePayload('fetch_table_page', (request) =>
    tablePageResponse({ ...page, currentPage: Number(request.page) })
  )
}

beforeEach(() => {
  useTableDataStore.setState({ tabs: {} })
  useConnectionStore.setState({ activeConnections: {}, activeTabId: null })
  servePage(KEYED_PAGE)
  ipc.override('get_table_foreign_keys', () => [])
  ipc.override('export_table_data', () => undefined)
})

async function waitForTableDataLoaded() {
  await waitFor(() => {
    expect(screen.getByTestId('table-data-grid')).toBeInTheDocument()
  })
  await waitFor(() => {
    expect(useTableDataStore.getState().tabs[TAB_ID]?.page.isLoading).toBe(false)
  })
}

describe('TableDataTab', () => {
  it('opens the table in the store, shows the loading state, then the grid in bottom-panel mode', async () => {
    setupTestConnection()
    const tab = makeTab({ databaseName: 'testdb', objectName: 'orders' })
    render(<TableDataTab tab={tab} renderMode="bottom-panel" />)

    expect(screen.getByTestId('table-data-tab')).toHaveAttribute('data-render-mode', 'bottom-panel')
    expect(screen.getByTestId('table-data-toolbar')).toBeInTheDocument()
    expect(screen.getByText('Loading table data...')).toBeInTheDocument()
    expect(useTableDataStore.getState().tabs[TAB_ID]?.table).toEqual({
      connectionId: 'conn-1',
      database: 'testdb',
      table: 'orders',
      isView: false,
    })

    await waitForTableDataLoaded()
    expect(screen.queryByTestId('no-pk-warning')).not.toBeInTheDocument()
    expect(screen.getByTestId('btn-add-row')).toBeInTheDocument()
    expect(screen.queryByTestId('view-badge')).not.toBeInTheDocument()
  })

  it('shows the no-key warning for a keyless table but not for a view', async () => {
    setupTestConnection()
    servePage(KEYLESS_PAGE)
    const { unmount } = render(<TableDataTab tab={makeTab()} />)

    expect(await screen.findByTestId('no-pk-warning')).toBeInTheDocument()
    expect(screen.getByText(/no primary key or unique key/i)).toBeInTheDocument()
    unmount()

    act(() => useTableDataStore.setState({ tabs: {} }))
    render(<TableDataTab tab={makeTab({ objectType: 'view', objectName: 'my_view' })} />)
    await waitForTableDataLoaded()

    expect(screen.queryByTestId('no-pk-warning')).not.toBeInTheDocument()
    expect(screen.getByTestId('view-badge')).toBeInTheDocument()
    expect(screen.queryByTestId('btn-add-row')).not.toBeInTheDocument()
    expect(screen.queryByTestId('btn-delete-row')).not.toBeInTheDocument()
    expect(screen.queryByTestId('btn-save')).not.toBeInTheDocument()
    expect(screen.queryByTestId('btn-discard')).not.toBeInTheDocument()
  })

  it('shows the read-only badge and makes editing follow the read-only flag live', async () => {
    const editTableName = () => useTableDataStore.getState().tabs[TAB_ID]?.view.editTarget.tableName
    setupTestConnection(true)
    render(<TableDataTab tab={makeTab()} />)

    await waitForTableDataLoaded()

    expect(screen.getByTestId('readonly-badge')).toBeInTheDocument()
    expect(editTableName()).toBeNull()

    act(() => setupTestConnection(false))
    await waitFor(() => expect(editTableName()).toBe('mydb.users'))

    act(() => setupTestConnection(true))
    await waitFor(() => expect(editTableName()).toBeNull())
    expect(ipc.payloads('fetch_table_page')).toHaveLength(1)
  })

  it('shows the load error with a retry that reloads the table', async () => {
    const user = userEvent.setup()
    setupTestConnection()
    let attempt = 0
    ipc.override('fetch_table_page', () => {
      attempt += 1
      if (attempt === 1) throw new Error('Connection lost')
      return tablePageResponse(KEYED_PAGE)
    })
    render(<TableDataTab tab={makeTab()} />)

    expect(await screen.findByTestId('table-data-error')).toHaveTextContent('Connection lost')

    await user.click(screen.getByTestId('btn-retry'))

    await waitForTableDataLoaded()
    expect(ipc.calls('fetch_table_page')).toHaveLength(2)
    expect(screen.queryByTestId('table-data-error')).not.toBeInTheDocument()
  })

  it('shows the failure bands with a Retry for a failed window or view change', async () => {
    const user = userEvent.setup()
    setupTestConnection()
    render(<TableDataTab tab={makeTab()} />)
    await waitForTableDataLoaded()
    expect(screen.queryByTestId('table-data-band-slot')).not.toBeInTheDocument()

    act(() => updateView(tableSurfaceRef(TAB_ID), { window: { failedRange: [0, 2] } }))
    expect(screen.getByTestId('result-window-error-band')).toHaveTextContent(
      "Couldn't load rows 1–2"
    )
    await user.click(screen.getByTestId('window-error-retry'))
    await waitFor(() =>
      expect(screen.queryByTestId('table-data-band-slot')).not.toBeInTheDocument()
    )

    act(() => updateView(tableSurfaceRef(TAB_ID), { spec: { error: 'Unknown column' } }))
    expect(screen.getByTestId('result-view-error-band')).toHaveTextContent('Unknown column')
    await user.click(screen.getByTestId('view-error-retry'))
    await waitFor(() => expect(ipc.calls('fetch_table_page')).toHaveLength(2))
  })

  it('exports the whole filtered table with the current page scope and closes the dialog', async () => {
    const user = userEvent.setup()
    setupTestConnection()
    render(<TableDataTab tab={makeTab()} />)
    await waitForTableDataLoaded()
    await act(async () => {
      await useTableDataStore.getState().fetchPage(TAB_ID, { page: 3, select: null })
    })

    act(() => openExportDialog(tableSurfaceRef(TAB_ID)))

    expect(await screen.findByTestId('export-dialog')).toBeInTheDocument()
    expect(screen.queryByText(/total rows/i)).not.toBeInTheDocument()
    fireEvent.change(screen.getByTestId('export-file-path-input'), {
      target: { value: '/tmp/export-users.csv' },
    })
    await user.click(screen.getByTestId('export-submit-button'))

    await waitFor(() => {
      expect(ipc.payloads('export_table_data')).toContainEqual(
        expect.objectContaining({
          connectionId: 'conn-1',
          database: 'mydb',
          table: 'users',
          format: 'csv',
          filePath: '/tmp/export-users.csv',
          includeHeaders: true,
          tableNameForSql: 'users',
          page: 3,
          pageSize: 1000,
        })
      )
    })
    await waitFor(() => {
      expect(screen.queryByTestId('export-dialog')).not.toBeInTheDocument()
    })
  })
})
