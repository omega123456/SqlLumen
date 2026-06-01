import { act, render } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import * as canvasGridModule from '../../../components/shared/glide/CanvasBaseGridView'
import * as baseFormViewModule from '../../../components/shared/BaseFormView'
import * as blobViewerDialogModule from '../../../components/dialogs/BlobViewerDialog'
import { TableDataGrid } from '../../../components/table-data/TableDataGrid'
import { TableDataFormView } from '../../../components/table-data/TableDataFormView'
import { useTableDataStore } from '../../../stores/table-data-store'
import { useToastStore } from '../../../stores/toast-store'
import { base64ToBytes } from '../../../lib/blob-utils'
import { ipc } from '../../ipc-mock'
import { makeTableDataTabState, setupTestConnection } from '../../helpers/table-data-test-utils'
import type { BlobEnvelope, TableDataColumnMeta, TableDataTabState } from '../../../types/schema'

const canvasCalls: unknown[] = []
const baseFormCalls: unknown[] = []
let capturedBlobDialogProps: Record<string, unknown> | null = null

function makeColumn(overrides: Partial<TableDataColumnMeta>): TableDataColumnMeta {
  return {
    name: 'col',
    dataType: 'VARCHAR',
    isNullable: false,
    isPrimaryKey: false,
    isUniqueKey: false,
    hasDefault: false,
    columnDefault: null,
    isBinary: false,
    isBooleanAlias: false,
    isAutoIncrement: false,
    ...overrides,
  }
}

const binaryPkColumns: TableDataColumnMeta[] = [
  makeColumn({ name: 'pk', dataType: 'BINARY', isPrimaryKey: true, isBinary: true }),
  makeColumn({ name: 'data', dataType: 'BLOB', isBinary: true }),
]

const compositePkColumns: TableDataColumnMeta[] = [
  makeColumn({ name: 'tenant', dataType: 'INT', isPrimaryKey: true }),
  makeColumn({ name: 'ref', dataType: 'VARBINARY', isPrimaryKey: true, isBinary: true }),
  makeColumn({ name: 'data', dataType: 'BLOB', isBinary: true }),
]

const intPkColumns: TableDataColumnMeta[] = [
  makeColumn({ name: 'id', dataType: 'INT', isPrimaryKey: true }),
  makeColumn({ name: 'data', dataType: 'BLOB', isBinary: true }),
]

function tab(
  columns: TableDataColumnMeta[],
  keyColumns: string[],
  rows: unknown[][]
): TableDataTabState {
  return makeTableDataTabState({
    columns,
    rows,
    primaryKey: { keyColumns, hasAutoIncrement: false, isUniqueKeyFallback: false },
    executionTimeMs: 1,
  })
}

function setStore(state: TableDataTabState): void {
  setupTestConnection()
  act(() => useTableDataStore.setState({ tabs: { t1: state } }))
}

beforeEach(() => {
  canvasCalls.length = 0
  baseFormCalls.length = 0
  capturedBlobDialogProps = null
  act(() => useToastStore.setState({ toasts: [] }))

  Object.defineProperty(canvasGridModule, 'CanvasBaseGridView', {
    configurable: true,
    value: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
      canvasCalls.push(props)
      React.useImperativeHandle(ref, () => ({
        selectCell: () => {},
        scrollToCell: () => {},
        element: null,
      }))
      return React.createElement('div', { 'data-testid': 'grid' })
    }),
  })
  Object.defineProperty(baseFormViewModule, 'BaseFormView', {
    configurable: true,
    value: (props: Record<string, unknown>) => {
      baseFormCalls.push(props)
      return React.createElement('div', { 'data-testid': 'form-view' })
    },
  })
  Object.defineProperty(blobViewerDialogModule, 'BlobViewerDialog', {
    configurable: true,
    value: (props: Record<string, unknown>) => {
      capturedBlobDialogProps = props
      return props.isOpen ? React.createElement('div', { 'data-testid': 'blob-dialog' }) : null
    },
  })
})

function lastGridProps() {
  return canvasCalls[canvasCalls.length - 1] as {
    onCellDoubleClick: (row: Record<string, unknown>, columnKey: string) => void
  }
}

function lastFormProps() {
  return baseFormCalls[baseFormCalls.length - 1] as {
    onBlobView: (column: { key: string }, rowData: Record<string, unknown> | null) => void
  }
}

async function runLoader(): Promise<void> {
  const loader = capturedBlobDialogProps?.loader as (() => Promise<unknown>) | undefined
  if (loader) {
    await act(async () => {
      await loader()
    })
  }
}

function lastFetchPkPairs(): [string, unknown][] {
  const calls = ipc.calls('fetch_blob_value')
  const args = calls[calls.length - 1] as { pkPairs: [string, unknown][] }
  return args.pkPairs
}

function isBytesEnvelope(value: unknown): value is BlobEnvelope & { base64: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).kind === 'bytes'
  )
}

describe('blob fetch with binary primary key — TableDataGrid', () => {
  it('sends a bytes envelope for a binary PK with order preserved', async () => {
    setStore(tab(binaryPkColumns, ['pk'], [['0xABCDEF01', '[BLOB - 4 bytes]']]))
    render(<TableDataGrid tabId="t1" isReadOnly={false} />)
    act(() => {
      lastGridProps().onCellDoubleClick({ pk: '0xABCDEF01', data: '[BLOB - 4 bytes]' }, 'data')
    })
    await runLoader()

    const pkPairs = lastFetchPkPairs()
    expect(pkPairs).toHaveLength(1)
    expect(pkPairs[0][0]).toBe('pk')
    expect(isBytesEnvelope(pkPairs[0][1])).toBe(true)
    expect(Array.from(base64ToBytes((pkPairs[0][1] as { base64: string }).base64))).toEqual([
      0xab, 0xcd, 0xef, 0x01,
    ])
  })

  it('preserves tuple order for a composite binary/non-binary PK', async () => {
    setStore(tab(compositePkColumns, ['tenant', 'ref'], [[7, '0x1234', '[BLOB - 2 bytes]']]))
    render(<TableDataGrid tabId="t1" isReadOnly={false} />)
    act(() => {
      lastGridProps().onCellDoubleClick({ tenant: 7, ref: '0x1234', data: '[BLOB - 2 bytes]' }, 'data')
    })
    await runLoader()

    const pkPairs = lastFetchPkPairs()
    expect(pkPairs.map((pair) => pair[0])).toEqual(['tenant', 'ref'])
    expect(pkPairs[0][1]).toBe(7)
    expect(isBytesEnvelope(pkPairs[1][1])).toBe(true)
  })

  it('leaves a non-binary PK unchanged', async () => {
    setStore(tab(intPkColumns, ['id'], [[42, '[BLOB - 4 bytes]']]))
    render(<TableDataGrid tabId="t1" isReadOnly={false} />)
    act(() => {
      lastGridProps().onCellDoubleClick({ id: 42, data: '[BLOB - 4 bytes]' }, 'data')
    })
    await runLoader()

    expect(lastFetchPkPairs()).toEqual([['id', 42]])
  })

  it('aborts with a toast and makes no IPC call on malformed binary PK hex', () => {
    setStore(tab(binaryPkColumns, ['pk'], [['0xZZ', '[BLOB - 1 bytes]']]))
    render(<TableDataGrid tabId="t1" isReadOnly={false} />)
    act(() => {
      lastGridProps().onCellDoubleClick({ pk: '0xZZ', data: '[BLOB - 1 bytes]' }, 'data')
    })

    expect(ipc.calls('fetch_blob_value')).toHaveLength(0)
    expect(useToastStore.getState().toasts.some((toast) => toast.variant === 'error')).toBe(true)
  })
})

describe('blob fetch with binary primary key — TableDataFormView', () => {
  it('sends a bytes envelope for a binary PK', async () => {
    setStore(
      tab(binaryPkColumns, ['pk'], [['0xABCDEF01', '[BLOB - 4 bytes]']]) as TableDataTabState
    )
    act(() =>
      useTableDataStore.setState((s) => ({
        tabs: { t1: { ...s.tabs.t1, selectedRowKey: { pk: '0xABCDEF01' }, viewMode: 'form' } },
      }))
    )
    render(<TableDataFormView tabId="t1" />)
    act(() => {
      lastFormProps().onBlobView({ key: 'data' }, { pk: '0xABCDEF01', data: '[BLOB - 4 bytes]' })
    })
    await runLoader()

    const pkPairs = lastFetchPkPairs()
    expect(pkPairs[0][0]).toBe('pk')
    expect(isBytesEnvelope(pkPairs[0][1])).toBe(true)
  })

  it('aborts with a toast and makes no IPC call on malformed binary PK hex', () => {
    setStore(tab(binaryPkColumns, ['pk'], [['0xZZ', '[BLOB - 1 bytes]']]) as TableDataTabState)
    act(() =>
      useTableDataStore.setState((s) => ({
        tabs: { t1: { ...s.tabs.t1, selectedRowKey: { pk: '0xZZ' }, viewMode: 'form' } },
      }))
    )
    render(<TableDataFormView tabId="t1" />)
    act(() => {
      lastFormProps().onBlobView({ key: 'data' }, { pk: '0xZZ', data: '[BLOB - 1 bytes]' })
    })

    expect(ipc.calls('fetch_blob_value')).toHaveLength(0)
    expect(useToastStore.getState().toasts.some((toast) => toast.variant === 'error')).toBe(true)
  })
})
