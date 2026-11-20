import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useBlobViewer } from '../../../../components/shared/data-view/use-blob-viewer'
import { useDataEditSession } from '../../../../components/shared/data-view/use-data-edit-session'
import { useDataColumnDescriptors } from '../../../../components/shared/data-view/data-column-descriptors'
import { tableSurfaceRef, useTableDataStore } from '../../../../stores/table-data-store'
import { useDataView } from '../../../../stores/data-view/use-data-view'
import { useToastStore } from '../../../../stores/toast-store'
import { base64ToBytes } from '../../../../lib/blob-utils'
import type { PrimaryKeyInfo, TableDataColumnMeta } from '../../../../types/schema'
import { expectToast, ipc } from '../../../ipc-mock'
import { loadTablePage, setupTestConnection } from '../../../helpers/table-data-test-utils'
import { makeTableColumnMeta } from '../../../helpers/column-meta-fixtures'

const TAB_ID = 'tab-1'
const REF = tableSurfaceRef(TAB_ID)
const EMPTY_ENVELOPE = { __sqllumen_blob__: true as const, kind: 'empty' as const }
const PLACEHOLDER = '[BLOB - 4 B]'

const ID_KEY_COLUMNS = [
  makeTableColumnMeta({ name: 'id', dataType: 'int', isPrimaryKey: true, isNullable: false }),
  makeTableColumnMeta({ name: 'payload', dataType: 'blob', isBinary: true }),
]
const BINARY_KEY_COLUMNS = [
  makeTableColumnMeta({ name: 'hash', dataType: 'binary', isBinary: true, isPrimaryKey: true }),
  makeTableColumnMeta({ name: 'payload', dataType: 'blob', isBinary: true }),
]
const COMPOSITE_KEY_COLUMNS = [
  makeTableColumnMeta({ name: 'tenant', dataType: 'int', isPrimaryKey: true }),
  makeTableColumnMeta({ name: 'ref', dataType: 'varbinary', isPrimaryKey: true, isBinary: true }),
  makeTableColumnMeta({ name: 'payload', dataType: 'blob', isBinary: true }),
]

interface StoredBlobTable {
  columns: TableDataColumnMeta[]
  keyColumns: string[]
  row: unknown[]
}

function primaryKeyOf(keyColumns: string[]): PrimaryKeyInfo | null {
  if (keyColumns.length === 0) return null
  return { keyColumns: keyColumns, hasAutoIncrement: false, isUniqueKeyFallback: false }
}

async function loadStoredBlobTable({ columns, keyColumns, row }: StoredBlobTable) {
  await act(async () => {
    await loadTablePage(TAB_ID, {
      columns: columns,
      rows: [row],
      primaryKey: primaryKeyOf(keyColumns),
    })
  })
}

function gridRowOf(row: unknown[]) {
  const cells = Object.fromEntries(row.map((value, columnIndex) => [`col_${columnIndex}`, value]))
  return { __rowIdx: 0, __baseIdx: 0, ...cells }
}

function renderTableBlobViewer() {
  return renderHook(() => {
    const session = useDataEditSession(REF)
    const columns = useDataView(REF, (view) => view.slot.columns)
    const editTarget = useDataView(REF, (view) => view.editTarget)
    const { descriptors } = useDataColumnDescriptors({
      columns: columns,
      editTarget: editTarget,
      metadata: null,
    })
    return { viewer: useBlobViewer({ session: session, columns: descriptors }), descriptors }
  })
}

function lastFetchKeyPairs(): [string, unknown][] {
  const requests = ipc.payloads('fetch_blob_value') as { primaryKeyPairs: [string, unknown][] }[]
  return requests[requests.length - 1].primaryKeyPairs
}

function bytesOfEnvelope(value: unknown): number[] {
  return Array.from(base64ToBytes((value as { base64: string }).base64))
}

const ID_KEY_TABLE: StoredBlobTable = {
  columns: ID_KEY_COLUMNS,
  keyColumns: ['id'],
  row: [1, PLACEHOLDER],
}

beforeEach(() => {
  setupTestConnection()
  useToastStore.setState({ toasts: [] })
  ipc.override('get_table_foreign_keys', () => [])
})

afterEach(() => {
  act(() => {
    useTableDataStore.setState({ tabs: {} })
  })
})

describe('useBlobViewer on the table route', () => {
  it('opens an editable target, loads the placeholder by primary key and applies an envelope', async () => {
    await loadStoredBlobTable(ID_KEY_TABLE)
    const { result } = renderTableBlobViewer()

    act(() => result.current.viewer.openBlobViewer(gridRowOf(ID_KEY_TABLE.row), 'col_1'))

    expect(result.current.viewer.target).toMatchObject({
      columnLabel: 'payload',
      isEditable: true,
    })
    await act(async () => {
      await result.current.viewer.target?.content.loader?.()
    })
    expect(ipc.payloads('fetch_blob_value')).toContainEqual({
      connectionId: 'conn-1',
      database: 'mydb',
      table: 'users',
      column: 'payload',
      primaryKeyPairs: [['id', 1]],
    })

    act(() => result.current.viewer.applyBlob(EMPTY_ENVELOPE))

    const editState = useTableDataStore.getState().tabs[TAB_ID]?.view.edit.state
    expect(editState?.currentValues.payload).toEqual(EMPTY_ENVELOPE)
    expect(editState?.modifiedColumns.has('payload')).toBe(true)

    act(() => result.current.viewer.closeBlobViewer())
    expect(result.current.viewer.target).toBeNull()
  })

  it('opens from a form field only when row data is present and ignores apply without a target', async () => {
    await loadStoredBlobTable(ID_KEY_TABLE)
    const { result } = renderTableBlobViewer()
    const payloadColumn = result.current.descriptors[1]

    act(() => result.current.viewer.openFormFieldBlob(payloadColumn, null))
    expect(result.current.viewer.target).toBeNull()
    act(() => result.current.viewer.applyBlob(EMPTY_ENVELOPE))
    expect(useTableDataStore.getState().tabs[TAB_ID]?.view.edit.state).toBeNull()

    act(() => result.current.viewer.openFormFieldBlob(payloadColumn, gridRowOf(ID_KEY_TABLE.row)))
    expect(result.current.viewer.target?.cell.columnKey).toBe('col_1')
  })

  it('does not open for non-blob columns or tables without a primary key', async () => {
    await loadStoredBlobTable(ID_KEY_TABLE)
    const { result } = renderTableBlobViewer()
    act(() => result.current.viewer.openBlobViewer(gridRowOf(ID_KEY_TABLE.row), 'col_0'))
    expect(result.current.viewer.target).toBeNull()

    await loadStoredBlobTable({ ...ID_KEY_TABLE, keyColumns: [] })
    act(() => result.current.viewer.openBlobViewer(gridRowOf(ID_KEY_TABLE.row), 'col_1'))
    expect(result.current.viewer.target).toBeNull()
  })

  it('sends a bytes envelope for a binary key and keeps composite key order', async () => {
    await loadStoredBlobTable({
      columns: BINARY_KEY_COLUMNS,
      keyColumns: ['hash'],
      row: ['0xABCDEF01', PLACEHOLDER],
    })
    const { result } = renderTableBlobViewer()
    act(() => result.current.viewer.openBlobViewer(gridRowOf(['0xABCDEF01', PLACEHOLDER]), 'col_1'))
    await act(async () => {
      await result.current.viewer.target?.content.loader?.()
    })

    const [binaryPair] = lastFetchKeyPairs()
    expect(binaryPair[0]).toBe('hash')
    expect(bytesOfEnvelope(binaryPair[1])).toEqual([0xab, 0xcd, 0xef, 0x01])

    const compositeRow = [7, '0x1234', PLACEHOLDER]
    await loadStoredBlobTable({
      columns: COMPOSITE_KEY_COLUMNS,
      keyColumns: ['tenant', 'ref'],
      row: compositeRow,
    })
    act(() => result.current.viewer.openBlobViewer(gridRowOf(compositeRow), 'col_2'))
    await act(async () => {
      await result.current.viewer.target?.content.loader?.()
    })

    const compositePairs = lastFetchKeyPairs()
    expect(compositePairs.map((pair) => pair[0])).toEqual(['tenant', 'ref'])
    expect(compositePairs[0][1]).toBe(7)
    expect(bytesOfEnvelope(compositePairs[1][1])).toEqual([0x12, 0x34])
  })

  it('shows an error and fetches nothing when the binary key cannot be converted', async () => {
    const malformedRow = ['0xZZ', PLACEHOLDER]
    await loadStoredBlobTable({
      columns: BINARY_KEY_COLUMNS,
      keyColumns: ['hash'],
      row: malformedRow,
    })
    const { result } = renderTableBlobViewer()

    act(() => result.current.viewer.openBlobViewer(gridRowOf(malformedRow), 'col_1'))

    expect(result.current.viewer.target).toBeNull()
    expect(ipc.payloads('fetch_blob_value')).toHaveLength(0)
    await expectToast('error', 'Could not open BLOB viewer')
  })
})
