import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TableDataGrid } from '../../../components/table-data/TableDataGrid'
import { useTableDataStore } from '../../../stores/table-data-store'
import type { TableDataTabState } from '../../../types/schema'

const gridHandle = vi.hoisted(() => ({
  selectCell: vi.fn(),
  scrollToCell: vi.fn(),
  element: null,
}))

const mockCanvasBaseGridView = vi.hoisted(() => vi.fn())

vi.mock('../../../components/shared/glide/CanvasBaseGridView', async () => {
  const React = await import('react')
  return {
    CanvasBaseGridView: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
      mockCanvasBaseGridView(props)
      React.useImperativeHandle(ref, () => gridHandle)
      return <div data-testid="table-grid" data-row-count={(props.rows as unknown[])?.length ?? 0} />
    }),
  }
})

let capturedFkLookupDialogProps: Record<string, unknown> | null = null

vi.mock('../../../components/table-data/FkLookupDialog', () => ({
  FkLookupDialog: (props: Record<string, unknown>) => {
    capturedFkLookupDialogProps = props
    return <div data-testid="fk-dialog" />
  },
}))

const columns = [
  {
    name: 'id',
    dataType: 'int',
    isBooleanAlias: false,
    isNullable: false,
    isPrimaryKey: true,
    isUniqueKey: true,
    hasDefault: false,
    columnDefault: null,
    isBinary: false,
    isAutoIncrement: false,
  },
  {
    name: 'name',
    dataType: 'varchar',
    isBooleanAlias: false,
    isNullable: true,
    isPrimaryKey: false,
    isUniqueKey: false,
    hasDefault: false,
    columnDefault: null,
    isBinary: false,
    isAutoIncrement: false,
  },
]

function tab(overrides: Partial<TableDataTabState> = {}): TableDataTabState {
  return {
    columns,
    rows: [[1, 'Ada']],
    currentPage: 1,
    pageSize: 100,
    primaryKey: { keyColumns: ['id'], hasAutoIncrement: false, isUniqueKeyFallback: false },
    executionTimeMs: 1,
    connectionId: 'c1',
    database: 'app',
    table: 'people',
    editState: null,
    viewMode: 'grid',
    selectedRowKey: null,
    columnWidths: {},
    selectedCell: null,
    filterModel: [],
    sort: null,
    foreignKeys: [],
    isLoading: false,
    error: null,
    saveError: null,
    isExportDialogOpen: false,
    scrollTop: 0,
    scrollLeft: 0,
    pendingNavigationAction: null,
    ...overrides,
  }
}

describe('TableDataGrid', () => {
  beforeEach(() => {
    mockCanvasBaseGridView.mockClear()
    gridHandle.selectCell.mockClear()
    gridHandle.scrollToCell.mockClear()
    capturedFkLookupDialogProps = null
    act(() => useTableDataStore.setState({ tabs: { t1: tab() } }))
  })

  it('renders table data rows and columns', () => {
    render(<TableDataGrid tabId="t1" isReadOnly={false} />)
    expect(screen.getByTestId('table-grid')).toHaveAttribute('data-row-count', '1')
    const props = mockCanvasBaseGridView.mock.lastCall?.[0] as {
      rows: Array<Record<string, unknown>>
      columns: Array<{ key: string }>
    }
    expect(props.columns.map((column) => column.key)).toEqual(['id', 'name'])
    expect(props.rows[0]).toMatchObject({ id: 1, name: 'Ada' })
  })

  it('cell editing triggers save synchronization', () => {
    act(() => {
      useTableDataStore.setState({
        tabs: {
          t1: tab({
            editState: {
              rowKey: { id: 1 },
              originalValues: { id: 1, name: 'Ada' },
              currentValues: { id: 1, name: 'Ada' },
              modifiedColumns: new Set(),
              isNewRow: false,
            },
          }),
        },
      })
    })
    const syncCellValue = vi.spyOn(useTableDataStore.getState(), 'syncCellValue')
    render(<TableDataGrid tabId="t1" isReadOnly={false} />)
    const props = mockCanvasBaseGridView.mock.lastCall?.[0] as {
      onRowsChange: (rows: Record<string, unknown>[], data: { indexes: number[]; column: { key: string } }) => void
    }
    props.onRowsChange([{ __rowIndex: 0, id: 1, name: 'Grace' }], {
      indexes: [0],
      column: { key: 'name' },
    })
    expect(syncCellValue).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ name: 'Grace' }),
      'name',
      'Grace',
      { id: 1 }
    )
  })

  it('row selection works through cell click guard', async () => {
    render(<TableDataGrid tabId="t1" isReadOnly={false} />)
    const props = mockCanvasBaseGridView.mock.lastCall?.[0] as {
      onCellClickGuard: (args: {
        rowIdx: number
        columnKey: string
        rowData: Record<string, unknown>
      }) => Promise<{ proceed: boolean; enableEditor: boolean }>
    }
    const result = await props.onCellClickGuard({ rowIdx: 0, columnKey: 'name', rowData: { id: 1, name: 'Ada' } })
    expect(result).toMatchObject({ proceed: true, enableEditor: true })
    expect(useTableDataStore.getState().tabs.t1.selectedRowKey).toEqual({ id: 1 })
  })

  it('column resize saves width', () => {
    render(<TableDataGrid tabId="t1" isReadOnly={false} />)
    const props = mockCanvasBaseGridView.mock.lastCall?.[0] as {
      onColumnResize: (columnKey: string, width: number) => void
    }
    act(() => props.onColumnResize('name', 240))
    expect(useTableDataStore.getState().tabs.t1.columnWidths?.name).toBe(240)
  })

  it('delete and add row store actions remain wired for rendered data', async () => {
    const store = useTableDataStore.getState()
    act(() => store.insertNewRow('t1'))
    expect(useTableDataStore.getState().tabs.t1.rows).toHaveLength(2)
    await act(async () => store.deleteRow('t1', { __tempId: useTableDataStore.getState().tabs.t1.editState?.tempId }))
    expect(useTableDataStore.getState().tabs.t1.rows).toHaveLength(1)
  })

  it('passes loading-state tabs as empty grid data without crashing', () => {
    act(() => useTableDataStore.setState({ tabs: { t1: tab({ isLoading: true, rows: [] }) } }))
    render(<TableDataGrid tabId="t1" isReadOnly={false} />)
    expect(screen.getByTestId('table-grid')).toHaveAttribute('data-row-count', '0')
  })

  it('restores grid focus to the selected FK cell when the lookup dialog closes', async () => {
    act(() =>
      useTableDataStore.setState({
        tabs: {
          t1: tab({
            selectedRowKey: { id: 1 },
            selectedCell: { columnKey: 'name', value: 'Ada' },
            foreignKeys: [
              {
                columnName: 'name',
                referencedDatabase: 'app',
                referencedTable: 'authors',
                referencedColumn: 'id',
                constraintName: 'fk_people_name_authors',
              },
            ],
          }),
        },
      })
    )

    render(<TableDataGrid tabId="t1" isReadOnly={false} />)

    const props = mockCanvasBaseGridView.mock.lastCall?.[0] as {
      onFkCellAction: (args: {
        rowIdx: number
        columnKey: string
        rowData: Record<string, unknown>
      }) => Promise<void>
    }

    await act(async () => {
      await props.onFkCellAction({ rowIdx: 0, columnKey: 'name', rowData: { id: 1, name: 'Ada' } })
    })

    expect(capturedFkLookupDialogProps).not.toBeNull()

    await act(async () => {
      ;(capturedFkLookupDialogProps?.onClose as (() => void) | undefined)?.()
    })

    await waitFor(() =>
      expect(gridHandle.selectCell).toHaveBeenCalledWith(
        { rowIdx: 0, idx: 1 },
        { shouldFocusCell: true, enableEditor: false }
      )
    )
  })
})
