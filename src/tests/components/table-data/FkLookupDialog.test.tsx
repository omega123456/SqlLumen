import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FkLookupDialog } from '../../../components/table-data/FkLookupDialog'
import { fetchTableData } from '../../../lib/table-data-commands'

const mockCanvasBaseGridView = vi.hoisted(() =>
  vi.fn((props: Record<string, unknown>) => (
    <div data-testid="fk-grid" data-row-count={(props.rows as unknown[])?.length ?? 0} />
  ))
)

vi.mock('../../../components/shared/glide/CanvasBaseGridView', () => ({
  CanvasBaseGridView: mockCanvasBaseGridView,
}))
vi.mock('../../../lib/table-data-commands', () => ({
  fetchTableData: vi.fn(),
}))

const response = {
  columns: [
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
      name: 'label',
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
  ],
  rows: [[1, 'One']],
  currentPage: 1,
  pageSize: 100,
  primaryKey: { keyColumns: ['id'], hasAutoIncrement: true, isUniqueKeyFallback: false },
  executionTimeMs: 12,
}

const props = {
  isOpen: true,
  onClose: vi.fn(),
  onApply: vi.fn(),
  connectionId: 'c1',
  database: 'app',
  sourceTable: 'orders',
  sourceColumn: 'customer_id',
  currentValue: null,
  referencedTable: 'customers',
  referencedColumn: 'id',
  isReadOnly: false,
}

describe('FkLookupDialog', () => {
  beforeEach(() => {
    vi.mocked(fetchTableData).mockResolvedValue(response)
    mockCanvasBaseGridView.mockClear()
  })

  it('renders FK lookup results', async () => {
    render(<FkLookupDialog {...props} />)
    expect(screen.getByTestId('fk-lookup-loading')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByTestId('fk-grid')).toHaveAttribute('data-row-count', '1')
    )
    expect(screen.getByTestId('fk-lookup-title')).toHaveTextContent('customers.id')
  })

  it('selecting a row fires apply callback', async () => {
    const onApply = vi.fn()
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<FkLookupDialog {...props} onApply={onApply} onClose={onClose} />)
    await waitFor(() => expect(mockCanvasBaseGridView).toHaveBeenCalled())
    const gridProps = mockCanvasBaseGridView.mock.lastCall?.[0] as {
      rows: Record<string, unknown>[]
      onRowClick: (row: Record<string, unknown>) => void
    }
    gridProps.onRowClick(gridProps.rows[0])
    await user.click(screen.getByTestId('fk-lookup-apply'))
    expect(onApply).toHaveBeenCalledWith(1)
    expect(onClose).toHaveBeenCalled()
  })

  it('closing fires cancel callback', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<FkLookupDialog {...props} onClose={onClose} />)
    await user.click(screen.getByTestId('fk-lookup-cancel'))
    expect(onClose).toHaveBeenCalled()
  })

  it('Escape key closes the dialog shell', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<FkLookupDialog {...props} onClose={onClose} />)

    await waitFor(() => expect(screen.getByTestId('fk-grid')).toBeInTheDocument())
    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalled()
  })

  it('filtering reloads data with filter model', async () => {
    const user = userEvent.setup()
    render(<FkLookupDialog {...props} />)
    await waitFor(() => expect(screen.getByTestId('fk-grid')).toBeInTheDocument())
    await user.click(screen.getByTestId('fk-lookup-btn-filter'))
    await user.click(screen.getByTestId('filter-add-button'))
    await user.type(screen.getByTestId('filter-value-input'), 'One')
    await user.click(screen.getByTestId('filter-apply-button'))
    await waitFor(() =>
      expect(vi.mocked(fetchTableData).mock.calls).toContainEqual([
        expect.objectContaining({ filterModel: [expect.objectContaining({ value: 'One' })] }),
      ])
    )
  })
})
