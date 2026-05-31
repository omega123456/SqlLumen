import { act, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as canvasGridModule from '../../../components/shared/glide/CanvasBaseGridView'
import * as fkLookupDialogModule from '../../../components/table-data/FkLookupDialog'
import * as blobViewerDialogModule from '../../../components/dialogs/BlobViewerDialog'
import { TableDataGrid } from '../../../components/table-data/TableDataGrid'
import { getAutoSizedColumnWidth } from '../../../lib/grid-column-style'
import { useTableDataStore } from '../../../stores/table-data-store'
import type { TableDataTabState } from '../../../types/schema'

const gridHandle = vi.hoisted(() => ({
  selectCell: vi.fn(),
  scrollToCell: vi.fn(),
  element: null,
}))

const canvasCalls: unknown[] = []

let capturedFkLookupDialogProps: Record<string, unknown> | null = null
let capturedBlobDialogProps: Record<string, unknown> | null = null

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
  {
    name: 'data',
    dataType: 'BLOB',
    isBooleanAlias: false,
    isNullable: true,
    isPrimaryKey: false,
    isUniqueKey: false,
    hasDefault: false,
    columnDefault: null,
    isBinary: true,
    isAutoIncrement: false,
  },
]

function tab(overrides: Partial<TableDataTabState> = {}): TableDataTabState {
  return {
    columns,
    rows: [[1, 'Ada', '[BLOB - 24 bytes]']],
    currentPage: 1,
    pageSize: 100,
    primaryKey: { keyColumns: ['id'], hasAutoIncrement: false, isUniqueKeyFallback: false },
    executionTimeMs: 1,
    rowsEvictedAt: null,
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
    scrollRow: 0,
    scrollCol: 0,
    pendingNavigationAction: null,
    ...overrides,
  }
}

describe('TableDataGrid', () => {
  beforeEach(() => {
    canvasCalls.length = 0
    Object.defineProperty(canvasGridModule, 'CanvasBaseGridView', {
      configurable: true,
      value: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
        canvasCalls.push(props)
        React.useImperativeHandle(ref, () => gridHandle)
        return React.createElement('div', { 'data-testid': 'table-data-grid' })
      }),
    })
    Object.defineProperty(fkLookupDialogModule, 'FkLookupDialog', {
      configurable: true,
      value: (props: Record<string, unknown>) => {
        capturedFkLookupDialogProps = props
        return props.isOpen
          ? React.createElement('div', { 'data-testid': 'fk-lookup-dialog' })
          : null
      },
    })
    Object.defineProperty(blobViewerDialogModule, 'BlobViewerDialog', {
      configurable: true,
      value: (props: Record<string, unknown>) => {
        capturedBlobDialogProps = props
        return props.isOpen
          ? React.createElement('div', { 'data-testid': 'blob-viewer-dialog' })
          : null
      },
    })
    gridHandle.selectCell.mockClear()
    gridHandle.scrollToCell.mockClear()
    capturedFkLookupDialogProps = null
    capturedBlobDialogProps = null
    act(() => useTableDataStore.setState({ tabs: { t1: tab() } }))
  })

  it('renders table data rows and columns', () => {
    render(<TableDataGrid tabId="t1" isReadOnly={false} />)
    expect(screen.getByTestId('table-data-grid')).toBeInTheDocument()
    const props = canvasCalls[canvasCalls.length - 1] as {
      rows: Array<Record<string, unknown>>
      columns: Array<{ key: string }>
    }
    expect(props.columns.map((column) => column.key)).toEqual(['id', 'name', 'data'])
    expect(props.rows[0]).toMatchObject({ id: 1, name: 'Ada' })
  })

  it('enables the checkbox row marker for editable (PK) tables', () => {
    render(<TableDataGrid tabId="t1" isReadOnly={false} />)
    const props = canvasCalls[canvasCalls.length - 1] as { rowMarkers: string }
    expect(props.rowMarkers).toBe('checkbox')
  })

  it('disables the checkbox row marker in read-only mode', () => {
    render(<TableDataGrid tabId="t1" isReadOnly={true} />)
    const props = canvasCalls[canvasCalls.length - 1] as { rowMarkers: string }
    expect(props.rowMarkers).toBe('none')
  })

  it('disables the checkbox row marker when the table has no primary key', () => {
    act(() => useTableDataStore.setState({ tabs: { t1: tab({ primaryKey: null }) } }))
    render(<TableDataGrid tabId="t1" isReadOnly={false} />)
    const props = canvasCalls[canvasCalls.length - 1] as { rowMarkers: string }
    expect(props.rowMarkers).toBe('none')
  })

  it('forwards checked rows to the store as primary-key row keys', () => {
    const setCheckedRowKeys = vi.spyOn(useTableDataStore.getState(), 'setCheckedRowKeys')
    render(<TableDataGrid tabId="t1" isReadOnly={false} />)
    const props = canvasCalls[canvasCalls.length - 1] as {
      onRowMarkersChange: (rows: Record<string, unknown>[]) => void
    }
    act(() => {
      props.onRowMarkersChange([{ __rowIndex: 0, id: 1, name: 'Ada' }])
    })
    expect(setCheckedRowKeys).toHaveBeenCalledWith('t1', [{ id: 1 }])
  })

  it('bumps resetSelectionKey when the store checked set clears after a delete', () => {
    act(() => {
      useTableDataStore.setState({ tabs: { t1: tab({ checkedRowKeys: [{ id: 1 }] }) } })
    })
    const { rerender } = render(<TableDataGrid tabId="t1" isReadOnly={false} />)
    const initialKey = (canvasCalls[canvasCalls.length - 1] as { resetSelectionKey: number })
      .resetSelectionKey

    // The toolbar clears checkedRowKeys to [] after a bulk delete.
    act(() => {
      useTableDataStore.setState({ tabs: { t1: tab({ checkedRowKeys: [] }) } })
    })
    rerender(<TableDataGrid tabId="t1" isReadOnly={false} />)
    const clearedKey = (canvasCalls[canvasCalls.length - 1] as { resetSelectionKey: number })
      .resetSelectionKey

    expect(clearedKey).toBe(initialKey + 1)
  })

  it('auto-size ignores in-progress edit text when computing widths', () => {
    act(() => {
      useTableDataStore.setState({
        tabs: {
          t1: tab({
            editState: {
              rowKey: { id: 1 },
              originalValues: { id: 1, name: 'Ada' },
              currentValues: { id: 1, name: 'this is a much much much longer in-progress value' },
              modifiedColumns: new Set(['name']),
              isNewRow: false,
            },
          }),
        },
      })
    })

    render(<TableDataGrid tabId="t1" isReadOnly={false} />)

    const props = canvasCalls[canvasCalls.length - 1] as {
      columns: Array<{ key: string; editable: boolean; foreignKey?: unknown }>
      autoSizeConfig: {
        computeWidth: (col: { key: string; editable: boolean; foreignKey?: unknown }) => number
      }
    }

    const expectedWidth = getAutoSizedColumnWidth(columns[1], 0, [['Ada']], 'name', 0)
    expect(props.autoSizeConfig.computeWidth(props.columns[1])).toBe(expectedWidth)
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
    const props = canvasCalls[canvasCalls.length - 1] as {
      onRowsChange: (
        rows: Record<string, unknown>[],
        data: { indexes: number[]; column: { key: string } }
      ) => void
    }
    act(() => {
      props.onRowsChange([{ __rowIndex: 0, id: 1, name: 'Grace' }], {
        indexes: [0],
        column: { key: 'name' },
      })
    })
    expect(syncCellValue).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ name: 'Grace' }),
      'name',
      'Grace',
      { id: 1 }
    )
  })

  it('no-op row cleanup does not mark table-data cells dirty', () => {
    const syncCellValue = vi.spyOn(useTableDataStore.getState(), 'syncCellValue')
    syncCellValue.mockClear()
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
    render(<TableDataGrid tabId="t1" isReadOnly={false} />)
    const props = canvasCalls[canvasCalls.length - 1] as {
      onRowsChange: (
        rows: Record<string, unknown>[],
        data: { indexes: number[]; column: { key: string } }
      ) => void
    }

    act(() =>
      props.onRowsChange([{ __rowIndex: 0, id: 1, name: 'Ada' }], {
        indexes: [0],
        column: { key: 'name' },
      })
    )

    expect(syncCellValue).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ name: 'Ada' }),
      'name',
      'Ada',
      { id: 1 }
    )
    expect(useTableDataStore.getState().tabs.t1.editState).toBeNull()
  })

  it('genuine row changes still mark table-data cells dirty', () => {
    const syncCellValue = vi.spyOn(useTableDataStore.getState(), 'syncCellValue')
    syncCellValue.mockClear()
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
    render(<TableDataGrid tabId="t1" isReadOnly={false} />)
    const props = canvasCalls[canvasCalls.length - 1] as {
      onRowsChange: (
        rows: Record<string, unknown>[],
        data: { indexes: number[]; column: { key: string } }
      ) => void
    }

    act(() =>
      props.onRowsChange([{ __rowIndex: 0, id: 1, name: 'Grace' }], {
        indexes: [0],
        column: { key: 'name' },
      })
    )

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
    const props = canvasCalls[canvasCalls.length - 1] as {
      onCellClickGuard: (args: {
        rowIdx: number
        columnKey: string
        rowData: Record<string, unknown>
        source?: 'grid-pointer' | 'keyboard'
      }) => Promise<{ proceed: boolean; enableEditor: boolean }>
      editableColumnKeys: Set<string>
    }
    let result: Awaited<ReturnType<typeof props.onCellClickGuard>> | undefined
    await act(async () => {
      result = await props.onCellClickGuard({
        rowIdx: 0,
        columnKey: 'name',
        rowData: { id: 1, name: 'Ada' },
      })
    })
    expect(result).toMatchObject({ proceed: true, enableEditor: false })
    expect(useTableDataStore.getState().tabs.t1.selectedRowKey).toEqual({ id: 1 })
  })

  it('keyboard row navigation selects editable cells without opening an editor or editing the destination row', async () => {
    const startEditing = vi.spyOn(useTableDataStore.getState(), 'startEditing')
    act(() => {
      useTableDataStore.setState({
        tabs: {
          t1: tab({
            rows: [
              [1, 'Ada'],
              [2, 'Bob'],
            ],
          }),
        },
      })
    })

    render(<TableDataGrid tabId="t1" isReadOnly={false} />)
    const props = canvasCalls[canvasCalls.length - 1] as {
      rows: Array<Record<string, unknown>>
      onCellClickGuard: (args: {
        rowIdx: number
        columnKey: string
        rowData: Record<string, unknown>
        source?: 'grid-pointer' | 'keyboard'
      }) => Promise<{ proceed: boolean; enableEditor: boolean }>
    }

    let result: Awaited<ReturnType<typeof props.onCellClickGuard>> | undefined
    await act(async () => {
      result = await props.onCellClickGuard({
        rowIdx: 1,
        columnKey: 'name',
        rowData: props.rows[1],
        source: 'keyboard',
      })
    })

    expect(result).toMatchObject({ proceed: true, enableEditor: false })
    expect(useTableDataStore.getState().tabs.t1.selectedRowKey).toEqual({ id: 2 })
    expect(startEditing).toHaveBeenCalledWith(
      't1',
      { id: 2 },
      expect.objectContaining({ id: 2, name: 'Bob' })
    )
    expect(useTableDataStore.getState().tabs.t1.editState).not.toBeNull()
  })

  it('keyboard row navigation still validates current edits and restores focus without opening an editor', async () => {
    act(() => {
      useTableDataStore.setState({
        tabs: {
          t1: tab({
            columns: [columns[0], { ...columns[1], dataType: 'date' }],
            rows: [
              [1, 'bad-date'],
              [2, 'Bob'],
            ],
            editState: {
              rowKey: { id: 1 },
              originalValues: { id: 1, name: '2024-01-01' },
              currentValues: { id: 1, name: 'not-a-date' },
              modifiedColumns: new Set(['name']),
              isNewRow: false,
            },
          }),
        },
      })
    })

    render(<TableDataGrid tabId="t1" isReadOnly={false} />)
    const props = canvasCalls[canvasCalls.length - 1] as {
      rows: Array<Record<string, unknown>>
      onCellClickGuard: (args: {
        rowIdx: number
        columnKey: string
        rowData: Record<string, unknown>
        source?: 'grid-pointer' | 'keyboard'
      }) => Promise<{ proceed: boolean; enableEditor: boolean; restoreFocus?: boolean }>
    }

    let result: Awaited<ReturnType<typeof props.onCellClickGuard>> | undefined
    await act(async () => {
      result = await props.onCellClickGuard({
        rowIdx: 1,
        columnKey: 'name',
        rowData: props.rows[1],
        source: 'keyboard',
      })
    })

    expect(result).toMatchObject({
      proceed: false,
      enableEditor: false,
      restoreFocus: true,
      targetRowIdx: 0,
    })
    expect(useTableDataStore.getState().tabs.t1.selectedRowKey).toEqual({ id: 1 })
  })

  it('foreign-key columns remain inline-editable while retaining FK affordances', async () => {
    act(() =>
      useTableDataStore.setState({
        tabs: {
          t1: tab({
            columns: [
              columns[0],
              { ...columns[1], name: 'user_id', dataType: 'int', isNullable: false },
            ],
            rows: [[1, 101]],
            foreignKeys: [
              {
                columnName: 'user_id',
                referencedDatabase: 'app',
                referencedTable: 'users',
                referencedColumn: 'id',
                constraintName: 'fk_people_user_id_users',
              },
            ],
          }),
        },
      })
    )

    render(<TableDataGrid tabId="t1" isReadOnly={false} />)
    const props = canvasCalls[canvasCalls.length - 1] as {
      onCellClickGuard: (args: {
        rowIdx: number
        columnKey: string
        rowData: Record<string, unknown>
      }) => Promise<{ proceed: boolean; enableEditor: boolean }>
      editableColumnKeys: Set<string>
    }

    let result: Awaited<ReturnType<typeof props.onCellClickGuard>> | undefined
    await act(async () => {
      result = await props.onCellClickGuard({
        rowIdx: 0,
        columnKey: 'user_id',
        rowData: { id: 1, user_id: 101 },
      })
    })

    expect(result).toMatchObject({ proceed: true, enableEditor: false })
    expect(props.editableColumnKeys).toContain('user_id')
  })

  it('enables guarded keyboard navigation for editable table data grids', () => {
    render(<TableDataGrid tabId="t1" isReadOnly={false} />)
    const props = canvasCalls[canvasCalls.length - 1] as {
      runCellClickGuardOnKeyboardSelection: boolean
    }

    expect(props.runCellClickGuardOnKeyboardSelection).toBe(true)
  })

  it('column resize saves width', () => {
    render(<TableDataGrid tabId="t1" isReadOnly={false} />)
    const props = canvasCalls[canvasCalls.length - 1] as {
      onColumnResize: (columnKey: string, width: number) => void
    }
    act(() => props.onColumnResize('name', 240))
    expect(useTableDataStore.getState().tabs.t1.columnWidths?.name).toBe(240)
  })

  it('delete and add row store actions remain wired for rendered data', async () => {
    const store = useTableDataStore.getState()
    act(() => store.insertNewRow('t1'))
    expect(useTableDataStore.getState().tabs.t1.rows).toHaveLength(2)
    await act(async () =>
      store.deleteRow('t1', { __tempId: useTableDataStore.getState().tabs.t1.editState?.tempId })
    )
    expect(useTableDataStore.getState().tabs.t1.rows).toHaveLength(1)
  })

  it('passes loading-state tabs as empty grid data without crashing', () => {
    act(() => useTableDataStore.setState({ tabs: { t1: tab({ isLoading: true, rows: [] }) } }))
    render(<TableDataGrid tabId="t1" isReadOnly={false} />)
    expect(screen.getByTestId('table-data-grid')).toBeInTheDocument()
  })

  it('clears the FK lookup dialog when the selected FK cell closes', async () => {
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

    const props = canvasCalls[canvasCalls.length - 1] as {
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

    await waitFor(() => {
      expect(screen.queryByTestId('fk-lookup-dialog')).not.toBeInTheDocument()
    })

    expect(gridHandle.selectCell).toHaveBeenCalledWith(
      { rowIdx: 0, idx: 1 },
      { shouldFocusCell: true, enableEditor: false }
    )
  })

  it('tags binary columns with the blob-viewer marker but keeps them non-editable', () => {
    render(<TableDataGrid tabId="t1" isReadOnly={false} />)
    const props = canvasCalls[canvasCalls.length - 1] as {
      columns: Array<{ key: string; blobViewer?: boolean; editable: boolean; editorType?: string }>
    }
    const blobCol = props.columns.find((column) => column.key === 'data')!
    expect(blobCol.blobViewer).toBe(true)
    expect(blobCol.editable).toBe(false)
    expect(blobCol.editorType).toBe('none')
    const textCol = props.columns.find((column) => column.key === 'name')!
    expect(textCol.blobViewer).toBeUndefined()
  })

  it('opens the BLOB viewer in edit mode when double-clicking a binary cell with a PK', () => {
    render(<TableDataGrid tabId="t1" isReadOnly={false} />)
    const props = canvasCalls[canvasCalls.length - 1] as {
      onCellDoubleClick: (row: Record<string, unknown>, columnKey: string) => void
    }
    act(() => {
      props.onCellDoubleClick(
        { __rowIndex: 0, id: 1, name: 'Ada', data: '[BLOB - 24 bytes]' },
        'data'
      )
    })
    expect(screen.getByTestId('blob-viewer-dialog')).toBeInTheDocument()
    expect(capturedBlobDialogProps).toMatchObject({ mode: 'edit', columnLabel: 'data' })
    expect(typeof capturedBlobDialogProps?.loader).toBe('function')
  })

  it('does not open the BLOB viewer when double-clicking a non-binary cell', () => {
    render(<TableDataGrid tabId="t1" isReadOnly={false} />)
    const props = canvasCalls[canvasCalls.length - 1] as {
      onCellDoubleClick: (row: Record<string, unknown>, columnKey: string) => void
    }
    act(() => {
      props.onCellDoubleClick({ __rowIndex: 0, id: 1, name: 'Ada' }, 'name')
    })
    expect(screen.queryByTestId('blob-viewer-dialog')).not.toBeInTheDocument()
  })

  it('does not open the BLOB viewer for tables without a resolvable primary key', () => {
    act(() => useTableDataStore.setState({ tabs: { t1: tab({ primaryKey: null }) } }))
    render(<TableDataGrid tabId="t1" isReadOnly={false} />)
    const props = canvasCalls[canvasCalls.length - 1] as {
      onCellDoubleClick: (row: Record<string, unknown>, columnKey: string) => void
    }
    act(() => {
      props.onCellDoubleClick(
        { __rowIndex: 0, id: 1, name: 'Ada', data: '[BLOB - 24 bytes]' },
        'data'
      )
    })
    expect(screen.queryByTestId('blob-viewer-dialog')).not.toBeInTheDocument()
  })

  it('does not open the BLOB viewer on a read-only connection', () => {
    render(<TableDataGrid tabId="t1" isReadOnly={true} />)
    const props = canvasCalls[canvasCalls.length - 1] as {
      onCellDoubleClick: (row: Record<string, unknown>, columnKey: string) => void
    }
    act(() => {
      props.onCellDoubleClick(
        { __rowIndex: 0, id: 1, name: 'Ada', data: '[BLOB - 24 bytes]' },
        'data'
      )
    })
    expect(screen.queryByTestId('blob-viewer-dialog')).not.toBeInTheDocument()
  })

  it('stages a blob envelope on apply', () => {
    const stageBlobEnvelope = vi.spyOn(useTableDataStore.getState(), 'stageBlobEnvelope')
    render(<TableDataGrid tabId="t1" isReadOnly={false} />)
    const props = canvasCalls[canvasCalls.length - 1] as {
      onCellDoubleClick: (row: Record<string, unknown>, columnKey: string) => void
    }
    const row = { __rowIndex: 0, id: 1, name: 'Ada', data: '[BLOB - 24 bytes]' }
    act(() => {
      props.onCellDoubleClick(row, 'data')
    })
    const envelope = { __sqllumen_blob__: true as const, kind: 'empty' as const }
    act(() => {
      ;(capturedBlobDialogProps?.onApply as (e: unknown) => void)(envelope)
    })
    expect(stageBlobEnvelope).toHaveBeenCalledWith('t1', row, 'data', envelope)
  })
})
