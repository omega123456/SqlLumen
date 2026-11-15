import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LegacyResultGridView as ResultGridView } from '../../helpers/result-grid-test-utils'
import { makeForeignKeyColumn, makeTableColumnMeta } from '../../helpers/column-meta-fixtures'
import type { ColumnMeta, RowEditState } from '../../../types/schema'
import { useQueryStore } from '../../../stores/query-store'
import * as CanvasBaseGridViewModule from '../../../components/shared/glide/CanvasBaseGridView'
import * as FkLookupDialogModule from '../../../components/shared/FkLookupDialog'

const originalCanvasBaseGridView = CanvasBaseGridViewModule.CanvasBaseGridView
let mockCanvasBaseGridView: ReturnType<typeof vi.fn>

const columns: ColumnMeta[] = [
  { name: 'id', dataType: 'INT' },
  { name: 'role', dataType: 'INT' },
]

const roleForeignKey = makeForeignKeyColumn({
  columnName: 'role_id',
  referencedDatabase: 'appdb',
  referencedTable: 'roles',
  referencedColumn: 'id',
  constraintName: 'fk_users_role',
})

const baseProps = {
  columns: columns,
  rows: [
    [1, 5],
    [2, 6],
  ],
  sortColumn: null,
  sortDirection: null,
  onSortChanged: vi.fn(),
  selectedRowIndex: null,
  tabId: 'tab-1',
  editMode: 'appdb.users',
  editableColumnMap: new Map([
    [0, false],
    [1, true],
  ]),
  editState: null,
  editingRowIndex: null,
  editTableColumns: [
    makeTableColumnMeta({ name: 'id', dataType: 'int', isPrimaryKey: true, isNullable: false }),
    makeTableColumnMeta({ name: 'role_id', dataType: 'int' }),
  ],
  editForeignKeys: [roleForeignKey],
  editColumnBindings: new Map([
    [0, 'id'],
    [1, 'role_id'],
  ]),
  editLocation: { connectionId: 'conn-1', database: 'appdb', table: 'users' },
}

type FkCellAction = (args: {
  rowIdx: number
  columnKey: string
  rowData: Record<string, unknown>
  source?: 'grid-pointer' | 'keyboard'
}) => Promise<void>

function latestFkCellAction(): FkCellAction {
  const calls = mockCanvasBaseGridView.mock.calls
  const gridProps = calls[calls.length - 1]?.[0] as { onFkCellAction: FkCellAction }
  return gridProps.onFkCellAction
}

function makeCallbacks() {
  return {
    onRowSelected: vi.fn(),
    onStartEditing: vi.fn(),
    onUpdateCellValue: vi.fn(),
    onSyncCellValue: vi.fn(),
    onAutoSave: vi.fn(async () => true),
    onDiscardRow: vi.fn(),
  }
}

async function openLookupOnFirstRow(source: 'grid-pointer' | 'keyboard' = 'grid-pointer') {
  await act(async () => {
    await latestFkCellAction()({
      rowIdx: 0,
      columnKey: 'col_1',
      rowData: { __rowIdx: 0, __baseIdx: 0, col_0: 1, col_1: 5 },
      source: source,
    })
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  useQueryStore.setState({ tabs: {} })

  mockCanvasBaseGridView = vi.fn(
    () => (<div data-testid="mock-result-grid" />) as unknown as React.ReactElement
  )
  const mockFn = mockCanvasBaseGridView as unknown as (
    props: Record<string, unknown>
  ) => React.ReactElement
  Object.defineProperty(CanvasBaseGridViewModule, 'CanvasBaseGridView', {
    value: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) =>
      mockFn({ ...props, ref })
    ),
    writable: true,
    configurable: true,
  })

  vi.spyOn(FkLookupDialogModule, 'FkLookupDialog').mockImplementation((props) => {
    const dialogProps = props as unknown as Record<string, unknown>
    const apply = dialogProps.onApply as (value: unknown) => void
    return (
      <div data-testid="fk-lookup-dialog-mock">
        <div data-testid="fk-lookup-database">{String(dialogProps.database)}</div>
        <div data-testid="fk-lookup-source-table">{String(dialogProps.sourceTable)}</div>
        <div data-testid="fk-lookup-source-column">{String(dialogProps.sourceColumn)}</div>
        <button data-testid="fk-lookup-apply-same" onClick={() => apply(dialogProps.currentValue)}>
          Apply Same
        </button>
        <button data-testid="fk-lookup-apply-new" onClick={() => apply(9)}>
          Apply New
        </button>
      </div>
    ) as unknown as React.ReactElement
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  Object.defineProperty(CanvasBaseGridViewModule, 'CanvasBaseGridView', {
    value: originalCanvasBaseGridView,
    writable: true,
    configurable: true,
  })
})

describe('ResultGridView foreign-key lookup', () => {
  it('opens the lookup from the in-cell action and applies a new value', async () => {
    const user = userEvent.setup()
    const callbacks = makeCallbacks()
    render(<ResultGridView {...baseProps} {...callbacks} />)

    await openLookupOnFirstRow()

    expect(screen.getByTestId('fk-lookup-database')).toHaveTextContent('appdb')
    expect(screen.getByTestId('fk-lookup-source-table')).toHaveTextContent('users')
    expect(screen.getByTestId('fk-lookup-source-column')).toHaveTextContent('role_id')
    expect(callbacks.onRowSelected).toHaveBeenCalledWith(0)

    await user.click(screen.getByTestId('fk-lookup-apply-new'))

    expect(callbacks.onStartEditing).toHaveBeenCalledWith(0, { row: [1, 5], baseIndex: 0 })
    expect(callbacks.onSyncCellValue).toHaveBeenCalledWith(1, 9)
    await waitFor(() => {
      expect(screen.queryByTestId('fk-lookup-dialog-mock')).not.toBeInTheDocument()
    })
  })

  it('opens the lookup from the keyboard shortcut path', async () => {
    render(<ResultGridView {...baseProps} {...makeCallbacks()} />)

    await openLookupOnFirstRow('keyboard')

    expect(screen.getByTestId('fk-lookup-dialog-mock')).toBeInTheDocument()
  })

  it('does nothing for a column without a foreign key', async () => {
    render(<ResultGridView {...baseProps} {...makeCallbacks()} />)

    await act(async () => {
      await latestFkCellAction()({
        rowIdx: 0,
        columnKey: 'col_0',
        rowData: { __rowIdx: 0, __baseIdx: 0, col_0: 1, col_1: 5 },
      })
    })

    expect(screen.queryByTestId('fk-lookup-dialog-mock')).not.toBeInTheDocument()
  })

  it('keeps the dirty row and skips the lookup when saving it fails', async () => {
    const callbacks = { ...makeCallbacks(), onAutoSave: vi.fn(async () => false) }
    const dirtyEditState: RowEditState = {
      rowKey: { id: 2 },
      originalValues: { id: 2, role_id: 6 },
      currentValues: { id: 2, role_id: 8 },
      modifiedColumns: new Set(['role_id']),
      isNewRow: false,
    }
    render(
      <ResultGridView
        {...baseProps}
        {...callbacks}
        editingRowIndex={1}
        editState={dirtyEditState}
      />
    )

    await openLookupOnFirstRow()

    expect(callbacks.onAutoSave).toHaveBeenCalledTimes(1)
    expect(callbacks.onStartEditing).not.toHaveBeenCalled()
    expect(screen.queryByTestId('fk-lookup-dialog-mock')).not.toBeInTheDocument()
  })

  it('reselects the row and writes nothing when the same value is applied', async () => {
    const user = userEvent.setup()
    const callbacks = makeCallbacks()
    render(<ResultGridView {...baseProps} {...callbacks} />)

    await openLookupOnFirstRow()
    await user.click(screen.getByTestId('fk-lookup-apply-same'))

    expect(callbacks.onSyncCellValue).not.toHaveBeenCalled()
    expect(callbacks.onStartEditing).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.queryByTestId('fk-lookup-dialog-mock')).not.toBeInTheDocument()
    })
  })
})
