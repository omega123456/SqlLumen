import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useBlobViewer } from '../../../../components/shared/data-view/use-blob-viewer'
import { useTableEditSession } from '../../../../components/table-data/table-data-edit-session'
import { buildColumnDescriptors } from '../../../../components/table-data/table-data-grid-columns'
import { useResultEditSession } from '../../../../components/query-editor/result-edit-session'
import { useResultColumnDescriptors } from '../../../../components/query-editor/result-column-descriptors'
import { useTableDataStore } from '../../../../stores/table-data-store'
import { useToastStore } from '../../../../stores/toast-store'
import type { TableDataColumnMeta } from '../../../../types/schema'
import { expectToast, ipc } from '../../../ipc-mock'
import { makeTableDataTabState } from '../../../helpers/table-data-test-utils'
import { makeTableColumnMeta } from '../../../helpers/column-meta-fixtures'

const TAB_ID = 'tab-1'
const EMPTY_ENVELOPE = { __sqllumen_blob__: true as const, kind: 'empty' as const }

const COLUMNS = [
  makeTableColumnMeta({ name: 'id', dataType: 'int', isPrimaryKey: true, isNullable: false }),
  makeTableColumnMeta({ name: 'payload', dataType: 'blob', isBinary: true }),
]
const BINARY_KEY_COLUMNS = [
  makeTableColumnMeta({ name: 'hash', dataType: 'binary', isBinary: true, isPrimaryKey: true }),
  makeTableColumnMeta({ name: 'payload', dataType: 'blob', isBinary: true }),
]
const ROW = { __rowIndex: 0, id: 1, payload: null }

interface TableViewerSetup {
  columns: TableDataColumnMeta[]
  primaryKeyColumns: string[]
  canEditRows: boolean
}

function renderTableBlobViewer({ columns, primaryKeyColumns, canEditRows }: TableViewerSetup) {
  const descriptors = buildColumnDescriptors({
    columns: columns,
    isReadOnly: !canEditRows,
    hasPrimaryKey: primaryKeyColumns.length > 0,
  })
  return renderHook(() => {
    const session = useTableEditSession({
      tabId: TAB_ID,
      columns: columns,
      primaryKeyColumns: primaryKeyColumns,
      descriptorColumns: descriptors,
      canEditRows: canEditRows,
    })
    return useBlobViewer({ session: session, columns: descriptors })
  })
}

const EDITABLE_TABLE: TableViewerSetup = {
  columns: COLUMNS,
  primaryKeyColumns: ['id'],
  canEditRows: true,
}

beforeEach(() => {
  useToastStore.setState({ toasts: [] })
  act(() => {
    useTableDataStore.setState({
      tabs: {
        [TAB_ID]: makeTableDataTabState({
          columns: COLUMNS,
          rows: [[1, null]],
          primaryKey: { keyColumns: ['id'], hasAutoIncrement: false, isUniqueKeyFallback: false },
        }),
      },
    })
  })
})

afterEach(() => {
  act(() => {
    useTableDataStore.setState({ tabs: {} })
  })
})

describe('useBlobViewer with table data', () => {
  it('opens an editable target and loads the blob by primary key through IPC', async () => {
    const { result } = renderTableBlobViewer(EDITABLE_TABLE)

    act(() => result.current.openBlobViewer(ROW, 'payload'))

    expect(result.current.target).toMatchObject({ columnLabel: 'payload', isEditable: true })
    await act(async () => {
      await result.current.target?.content.loader?.()
    })
    expect(ipc.payloads('fetch_blob_value')).toContainEqual({
      connectionId: 'conn-1',
      database: 'mydb',
      table: 'users',
      column: 'payload',
      primaryKeyPairs: [['id', 1]],
    })
  })

  it('writes an applied envelope into the edit state', () => {
    const { result } = renderTableBlobViewer(EDITABLE_TABLE)
    act(() => result.current.openBlobViewer(ROW, 'payload'))

    act(() => result.current.applyBlob(EMPTY_ENVELOPE))

    const editState = useTableDataStore.getState().tabs[TAB_ID]?.editState
    expect(editState?.currentValues.payload).toEqual(EMPTY_ENVELOPE)
    expect(editState?.modifiedColumns.has('payload')).toBe(true)
  })

  it('opens from a form field only when row data is present', () => {
    const { result } = renderTableBlobViewer(EDITABLE_TABLE)
    const payloadColumn = buildColumnDescriptors({
      columns: COLUMNS,
      isReadOnly: false,
      hasPrimaryKey: true,
    })[1]

    act(() => result.current.openFormFieldBlob(payloadColumn, null))
    expect(result.current.target).toBeNull()

    act(() => result.current.openFormFieldBlob(payloadColumn, ROW))
    expect(result.current.target?.cell.columnKey).toBe('payload')
  })

  it('closes the target', () => {
    const { result } = renderTableBlobViewer(EDITABLE_TABLE)
    act(() => result.current.openBlobViewer(ROW, 'payload'))

    act(() => result.current.closeBlobViewer())

    expect(result.current.target).toBeNull()
  })

  it('ignores apply without an open target and on read-only tables', () => {
    const { result } = renderTableBlobViewer({ ...EDITABLE_TABLE, canEditRows: false })
    act(() => result.current.applyBlob(EMPTY_ENVELOPE))

    act(() => result.current.openBlobViewer(ROW, 'payload'))
    expect(result.current.target?.isEditable).toBe(false)
    act(() => result.current.applyBlob(EMPTY_ENVELOPE))

    expect(useTableDataStore.getState().tabs[TAB_ID]?.editState).toBeNull()
  })

  it('does not open for non-blob columns or tables without a primary key', () => {
    const { result } = renderTableBlobViewer(EDITABLE_TABLE)
    act(() => result.current.openBlobViewer(ROW, 'id'))
    expect(result.current.target).toBeNull()

    const withoutKey = renderTableBlobViewer({ ...EDITABLE_TABLE, primaryKeyColumns: [] })
    act(() => withoutKey.result.current.openBlobViewer(ROW, 'payload'))
    expect(withoutKey.result.current.target).toBeNull()
  })

  it('shows an error when the primary key cannot be converted', () => {
    const { result } = renderTableBlobViewer({
      columns: BINARY_KEY_COLUMNS,
      primaryKeyColumns: ['hash'],
      canEditRows: true,
    })

    act(() => result.current.openBlobViewer({ hash: '0xZZ', payload: null }, 'payload'))

    expect(result.current.target).toBeNull()
    expectToast('error', 'Could not open BLOB viewer')
  })
})

describe('useBlobViewer with query results', () => {
  function renderResultBlobViewer() {
    const callbacks = {
      onStartEditing: vi.fn(),
      onUpdateCellValue: vi.fn(),
      onSyncCellValue: vi.fn(),
      onSaveRow: vi.fn(async () => true),
      onDiscardRow: vi.fn(),
      onRowSelected: vi.fn(),
    }
    const editInputs = {
      columns: [
        { name: 'id', dataType: 'INT' },
        { name: 'payload', dataType: 'BLOB' },
      ],
      editMode: 'mydb.users',
      editableColumnMap: new Map([
        [0, false],
        [1, false],
      ]),
      editTableColumns: COLUMNS,
      editForeignKeys: [],
      editColumnBindings: new Map([
        [0, 'id'],
        [1, 'payload'],
      ]),
    }
    const rendered = renderHook(() => {
      const { descriptors } = useResultColumnDescriptors(editInputs)
      const session = useResultEditSession({
        ...editInputs,
        ...callbacks,
        tabId: TAB_ID,
        resultIndex: 0,
        queryId: 'q1',
        viewVersion: 1,
        editState: null,
        editingRowIndex: null,
        editingBaseIndex: null,
      })
      return useBlobViewer({ session: session, columns: descriptors })
    })
    return { ...rendered, callbacks }
  }

  it('shows the inline cell value and writes applied envelopes through the editing row', () => {
    const { result, callbacks } = renderResultBlobViewer()
    const rowData = { __rowIdx: 0, __baseIdx: 0, col_0: 1, col_1: 'aGk=' }

    act(() => result.current.openBlobViewer(rowData, 'col_1'))

    expect(result.current.target).toMatchObject({
      columnLabel: 'payload',
      isEditable: true,
      content: { initialBase64: 'aGk=' },
    })

    act(() => result.current.applyBlob(EMPTY_ENVELOPE))

    expect(callbacks.onStartEditing).toHaveBeenCalledWith(0, { row: [1, 'aGk='], baseIndex: 0 })
    expect(callbacks.onSyncCellValue).toHaveBeenCalledWith(1, EMPTY_ENVELOPE)
  })
})
