import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as canvasGridModule from '../../../components/shared/glide/CanvasBaseGridView'
import { FkLookupDialog } from '../../../components/table-data/FkLookupDialog'
import { ipc } from '../../ipc-mock'

const originalCanvasBaseGridView = canvasGridModule.CanvasBaseGridView

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
    {
      name: 'enabled',
      dataType: 'tinyint',
      isBooleanAlias: false,
      isNullable: false,
      isPrimaryKey: false,
      isUniqueKey: false,
      hasDefault: false,
      columnDefault: null,
      isBinary: false,
      isAutoIncrement: false,
    },
  ],
  rows: [[1, 'One', '\u0001']],
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

const canvasCalls: unknown[] = []

describe('FkLookupDialog', () => {
  beforeEach(() => {
    ipc.override('fetch_table_data', () => response)
    ipc.override('evict_table_data', () => undefined)
    canvasCalls.length = 0
    Object.defineProperty(canvasGridModule, 'CanvasBaseGridView', {
      configurable: true,
      value: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
        canvasCalls.push(props)
        return React.createElement(originalCanvasBaseGridView as never, {
          ...props,
          ref,
        })
      }),
    })
  })

  it('renders FK lookup results', async () => {
    render(<FkLookupDialog {...props} />)
    expect(screen.getByTestId('fk-lookup-loading')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('fk-lookup-grid')).toBeInTheDocument())
    expect(screen.getByTestId('fk-lookup-title')).toHaveTextContent('customers.id')
    const gridProps = canvasCalls[canvasCalls.length - 1] as {
      rows: Record<string, unknown>[]
    }
    expect(gridProps.rows[0].enabled).toBe(1)
  })

  it('selecting a row fires apply callback', async () => {
    const onApply = vi.fn()
    const onClose = vi.fn()
    const user = userEvent.setup()

    render(<FkLookupDialog {...props} onApply={onApply} onClose={onClose} />)
    await waitFor(() => expect(canvasCalls.length).toBeGreaterThan(0))
    const gridProps = canvasCalls[canvasCalls.length - 1] as {
      rows: Record<string, unknown>[]
      onRowClick: (row: Record<string, unknown>) => void
    }
    act(() => {
      gridProps.onRowClick(gridProps.rows[0])
    })
    await user.click(screen.getByTestId('fk-lookup-apply'))
    expect(onApply).toHaveBeenCalledWith(1)
    expect(onClose).toHaveBeenCalled()
  })

  it('double-clicking a row applies immediately', async () => {
    const onApply = vi.fn()
    const onClose = vi.fn()
    render(<FkLookupDialog {...props} onApply={onApply} onClose={onClose} />)
    await waitFor(() => expect(canvasCalls.length).toBeGreaterThan(0))
    const gridProps = canvasCalls[canvasCalls.length - 1] as {
      rows: Record<string, unknown>[]
      onRowDoubleClicked: (row: Record<string, unknown>) => void
    }

    act(() => {
      gridProps.onRowDoubleClicked(gridProps.rows[0])
    })

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

    await waitFor(() => expect(screen.getByTestId('fk-lookup-grid')).toBeInTheDocument())
    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalled()
  })

  it('filtering reloads data with filter model', async () => {
    const user = userEvent.setup()
    render(<FkLookupDialog {...props} />)
    await waitFor(() => expect(screen.getByTestId('fk-lookup-grid')).toBeInTheDocument())
    await user.click(screen.getByTestId('fk-lookup-btn-filter'))
    await user.click(screen.getByTestId('filter-add-button'))
    await user.type(screen.getByTestId('filter-value-input'), 'One')
    await user.click(screen.getByTestId('filter-apply-button'))
    await waitFor(() => {
      expect(ipc.calls('fetch_table_data')).toContainEqual(
        expect.objectContaining({
          filterModel: [expect.objectContaining({ value: 'One' })],
        })
      )
    })
  })

  it('evicts the synthetic table-data cache entry on close', async () => {
    const { rerender } = render(<FkLookupDialog {...props} />)

    await waitFor(() => expect(screen.getByTestId('fk-lookup-grid')).toBeInTheDocument())

    rerender(<FkLookupDialog {...props} isOpen={false} />)

    await waitFor(() => {
      expect(ipc.calls('evict_table_data')).toContainEqual({
        connectionId: 'c1',
        tabId: 'fk-lookup-c1-app-customers',
      })
    })
  })
})
