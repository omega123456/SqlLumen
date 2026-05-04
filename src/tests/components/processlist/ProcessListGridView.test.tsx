import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import { ProcessListGridView } from '../../../components/processlist/ProcessListGridView'
import { useProcessListStore } from '../../../stores/processlist-store'

// Mock DataGrid
const mockDataGridFn = vi.fn()

vi.mock('../../../components/shared/DataGrid', async () => {
  const React = await import('react')
  return {
    DataGrid: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
      mockDataGridFn(props)
      React.useImperativeHandle(ref, () => ({ selectCell: vi.fn() }))
      const columns = props.columns as Array<{ key: string; name: string }>
      return React.createElement(
        'div',
        { 'data-testid': props['data-testid'] },
        columns?.map((c) =>
          React.createElement('span', { key: c.key, 'data-field': c.key }, c.name)
        )
      )
    }),
  }
})

const MOCK_ROWS = [
  {
    id: 1,
    user: 'root',
    host: 'localhost',
    db: 'testdb',
    command: 'Query',
    time: 5,
    state: 'executing',
    info: 'SELECT 1',
  },
  {
    id: 2,
    user: 'app',
    host: '10.0.0.1',
    db: null,
    command: 'Sleep',
    time: 100,
    state: '',
    info: null,
  },
]

beforeEach(() => {
  mockDataGridFn.mockClear()

  mockIPC((cmd) => {
    if (cmd === 'log_frontend') return undefined
    throw new Error(`[vitest] Unmocked Tauri IPC command: ${cmd}`)
  })

  useProcessListStore.setState({
    rowsByConnection: { 'conn-1': MOCK_ROWS },
    lastRefreshedAtByConnection: {},
    selectedIdsByConnection: { 'conn-1': new Set<number>() },
    refreshIntervalMsByConnection: {},
    excludeIdleConnectionsByConnection: {},
    isConfirmDialogOpenByConnection: {},
    isSummaryDialogOpenByConnection: {},
    sortColumnByConnection: {},
    lastErrorToastAtByConnection: {},
    fetchErrorByConnection: {},
    isFetchingByConnection: {},
    fetchGenerationByConnection: {},
    hasFetchedByConnection: {},
  })
})

describe('ProcessListGridView', () => {
  it('renders the grid view', () => {
    render(<ProcessListGridView connectionId="conn-1" />)
    expect(screen.getByTestId('processlist-grid-view')).toBeInTheDocument()
  })

  it('passes prefix columns (checkbox) to the grid', () => {
    render(<ProcessListGridView connectionId="conn-1" />)
    // DataGrid should be called with columns including __select__
    const lastCall = mockDataGridFn.mock.calls[mockDataGridFn.mock.calls.length - 1][0]
    const columnKeys = (lastCall.columns as Array<{ key: string }>).map((c) => c.key)
    expect(columnKeys[0]).toBe('__select__')
    expect(columnKeys).toContain('id')
    expect(columnKeys).toContain('user')
    expect(columnKeys).toContain('info')
  })

  it('checkbox column has comfortable width and centering class', () => {
    render(<ProcessListGridView connectionId="conn-1" />)
    const lastCall = mockDataGridFn.mock.calls[mockDataGridFn.mock.calls.length - 1][0]
    const selectCol = (
      lastCall.columns as Array<{ key: string; width: number; cellClass?: string }>
    ).find((c) => c.key === '__select__')
    expect(selectCol).toBeDefined()
    expect(selectCol!.width).toBe(48)
    expect(selectCol!.cellClass).toBe('rdg-checkbox-cell')
  })

  it('does not apply readonly cell styling to process list data columns', () => {
    render(<ProcessListGridView connectionId="conn-1" />)

    const lastCall = mockDataGridFn.mock.calls[mockDataGridFn.mock.calls.length - 1][0]
    const userCol = (
      lastCall.columns as Array<{
        key: string
        cellClass?: string | ((row: Record<string, unknown>) => string)
      }>
    ).find((c) => c.key === 'user')

    expect(userCol).toBeDefined()
    expect(typeof userCol!.cellClass).toBe('function')
    const className = (userCol!.cellClass as (row: Record<string, unknown>) => string)(MOCK_ROWS[0])
    expect(className).not.toContain('rdg-readonly-cell')
  })

  it('sorts rows when sortColumn is set', () => {
    useProcessListStore.setState({
      excludeIdleConnectionsByConnection: { 'conn-1': false },
    })
    useProcessListStore.setState({
      sortColumnByConnection: { 'conn-1': { columnKey: 'time', direction: 'DESC' } },
    })
    render(<ProcessListGridView connectionId="conn-1" />)
    const lastCall = mockDataGridFn.mock.calls[mockDataGridFn.mock.calls.length - 1][0]
    const rows = lastCall.rows as Array<Record<string, unknown>>
    // time=100 should come before time=5 in DESC
    expect(rows[0].time).toBe(100)
    expect(rows[1].time).toBe(5)
  })

  it('hides idle rows by default', () => {
    render(<ProcessListGridView connectionId="conn-1" />)

    const lastCall = mockDataGridFn.mock.calls[mockDataGridFn.mock.calls.length - 1][0]
    const rows = lastCall.rows as Array<Record<string, unknown>>

    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(1)
  })

  it('shows idle rows when the filter is disabled', () => {
    useProcessListStore.setState({
      excludeIdleConnectionsByConnection: { 'conn-1': false },
    })

    render(<ProcessListGridView connectionId="conn-1" />)

    const lastCall = mockDataGridFn.mock.calls[mockDataGridFn.mock.calls.length - 1][0]
    const rows = lastCall.rows as Array<Record<string, unknown>>

    expect(rows).toHaveLength(2)
  })

  it('passes empty rows when connection has no data', () => {
    useProcessListStore.setState({
      rowsByConnection: {},
    })
    render(<ProcessListGridView connectionId="conn-1" />)
    const lastCall = mockDataGridFn.mock.calls[mockDataGridFn.mock.calls.length - 1][0]
    expect((lastCall.rows as unknown[]).length).toBe(0)
  })

  it('marks selected rows with the shared selection class', () => {
    useProcessListStore.setState({
      selectedIdsByConnection: { 'conn-1': new Set([1]) },
    })

    render(<ProcessListGridView connectionId="conn-1" />)

    const lastCall = mockDataGridFn.mock.calls[mockDataGridFn.mock.calls.length - 1][0]
    const rowClass = lastCall.rowClass as (row: Record<string, unknown>) => string | undefined

    expect(rowClass(MOCK_ROWS[0])).toBe('rdg-row-precision-selected')
    expect(rowClass(MOCK_ROWS[1])).toBeUndefined()
  })
})
