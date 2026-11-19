import { resultState } from '../../helpers/legacy-result-fields'
import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ipc } from '../../ipc-mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ResultPanel } from '../../../components/query-editor/ResultPanel'
import { useQueryStore, querySurfaceRef } from '../../../stores/query-store'
import { makeTabState, withRows } from '../../helpers/query-test-utils'
import * as ResultSubTabsModule from '../../../components/query-editor/ResultSubTabs'
import * as DataToolbarModule from '../../../components/shared/data-view/DataToolbar'
import type { DataViewSource } from '../../../components/shared/data-view/data-view-source'
import * as DataGridViewModule from '../../../components/shared/data-view/DataGridView'
import * as DataFormViewModule from '../../../components/shared/data-view/DataFormView'
import * as DataTextViewModule from '../../../components/shared/data-view/DataTextView'
import * as ExportDialogModule from '../../../components/dialogs/ExportDialog'

// Use vi.spyOn to install per-test mock implementations without vi.mock().
// IPC commands are handled via ipc.override().

let capturedExportDialogProps: Record<string, unknown> = {}

beforeEach(() => {
  vi.clearAllMocks()
  capturedExportDialogProps = {}
  useQueryStore.setState({ tabs: {} })

  ipc.override('execute_query', () => ({
    queryId: 'q1',
    columns: [],
    totalRows: 0,
    executionTimeMs: 0,
    affectedRows: 0,
    autoLimitApplied: false,
    rows: [],
  }))
  ipc.override('fetch_cached_rows', () => ({ rows: [], columns: [] }))
  ipc.override('evict_results', () => undefined)
  ipc.override('sort_results', () => ({ rows: [] }))
  ipc.override('export_results', () => ({ bytesWritten: 1024, rowsExported: 2 }))
  ipc.override('fetch_table_data', () => ({
    columns: [],
    rows: [],
    currentPage: 1,
    pageSize: 100,
    primaryKey: null,
    executionTimeMs: 0,
  }))
  ipc.override('update_table_row', () => undefined)
  ipc.override('insert_table_row', () => [])
  ipc.override('delete_table_row', () => undefined)
  ipc.override('export_table_data', () => undefined)

  vi.spyOn(ResultSubTabsModule, 'ResultSubTabs').mockImplementation(
    ({ tabId }: { tabId: string }) =>
      (<div data-testid="result-subtabs">{tabId}</div>) as unknown as React.ReactElement
  )

  vi.spyOn(DataToolbarModule, 'DataToolbar').mockImplementation(
    () => (<div data-testid="result-toolbar" />) as unknown as React.ReactElement
  )

  vi.spyOn(DataGridViewModule.DataGridView, 'type').mockImplementation(
    () => (<div data-testid="result-grid-view" />) as unknown as React.ReactElement
  )

  vi.spyOn(DataFormViewModule, 'DataFormView').mockImplementation(
    () => (<div data-testid="result-form-view">Form View</div>) as unknown as React.ReactElement
  )

  vi.spyOn(DataTextViewModule, 'DataTextView').mockImplementation(
    ({ source }: { source: DataViewSource }) =>
      (
        <div data-testid="result-text-view">{source.ref.tabId}</div>
      ) as unknown as React.ReactElement
  )

  vi.spyOn(ExportDialogModule, 'default').mockImplementation((props) => {
    const p = props as unknown as Record<string, unknown>
    capturedExportDialogProps = p
    return (
      <button data-testid="export-dialog-close" onClick={p.onClose as () => void}>
        Close Export
      </button>
    ) as unknown as React.ReactElement
  })
})

function renderPanel(overrides: Record<string, unknown> = {}) {
  useQueryStore.setState({
    tabs: {
      'tab-1': makeTabState({
        status: 'success',
        connectionId: 'conn-1',
        columns: [
          { name: 'id', dataType: 'INT' },
          { name: 'role_id', dataType: 'INT' },
          { name: 'name', dataType: 'VARCHAR' },
        ],
        rows: [
          [1, 5, 'Alice'],
          [2, 6, 'Bob'],
        ],
        totalRows: 2,
        selectedRowIndex: 0,
        queryId: 'q1',
        ...overrides,
      }),
    },
  })

  return render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)
}

describe('ResultPanel actions and states', () => {
  it('renders running and error states with multi-result tabs', () => {
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          ...makeTabState({ connectionId: 'conn-1' }),
          tabStatus: 'running',
          results: [resultState({ resultStatus: 'success' })],
        },
      },
    })

    const { rerender } = render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByText('Executing query...')).toBeInTheDocument()

    useQueryStore.setState({
      tabs: {
        'tab-1': {
          ...makeTabState({ connectionId: 'conn-1' }),
          tabStatus: 'success',
          activeResultIndex: 1,
          results: [
            resultState({
              resultStatus: 'success',
              ...withRows([[1]]),
              view: { slot: { columns: [{ name: 'id', dataType: 'INT' }], totalRows: 1 } },
            }),
            resultState({ resultStatus: 'error', errorMessage: 'Broken query' }),
          ],
        },
      },
    })

    rerender(<ResultPanel tabId="tab-1" connectionId="conn-1" />)

    expect(screen.getByTestId('result-subtabs')).toHaveTextContent('tab-1')
    expect(screen.getByText('Broken query')).toBeInTheDocument()
  })

  it('suppresses result sub-tabs when hideSubTabs is true', () => {
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          ...makeTabState({ connectionId: 'conn-1' }),
          tabStatus: 'success',
          activeResultIndex: 1,
          results: [
            resultState({
              resultStatus: 'success',
              ...withRows([[1]]),
              view: { slot: { columns: [{ name: 'id', dataType: 'INT' }], totalRows: 1 } },
            }),
            resultState({ resultStatus: 'error', errorMessage: 'Broken query' }),
          ],
        },
      },
    })

    render(<ResultPanel tabId="tab-1" connectionId="conn-1" hideSubTabs />)

    expect(screen.queryByTestId('result-subtabs')).not.toBeInTheDocument()
    expect(screen.getByText('Broken query')).toBeInTheDocument()
  })

  it('shows affected row count for DML success results', () => {
    renderPanel({ columns: [], rows: [], affectedRows: 3 })

    expect(screen.getByTestId('dml-success')).toHaveTextContent('Query OK3 rows affected')
  })

  it('renders export dialog and closes it through the provided handler', async () => {
    const user = userEvent.setup()
    const closeExportDialogSpy = vi.spyOn(useQueryStore.getState(), 'closeExportDialog')

    renderPanel({ exportDialogOpen: true })

    expect(screen.getByTestId('export-dialog-close')).toBeInTheDocument()
    expect(capturedExportDialogProps.resultIndex).toBe(0)

    await user.click(screen.getByTestId('export-dialog-close'))

    expect(closeExportDialogSpy).toHaveBeenCalledWith(querySurfaceRef('tab-1', 0))
  })
})
