import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useBlobViewerState } from '../../../components/table-data/use-blob-viewer-state'
import { useTableDataStore } from '../../../stores/table-data-store'
import { useToastStore } from '../../../stores/toast-store'
import type { TableDataColumnMeta } from '../../../types/schema'
import { expectToast, ipc } from '../../ipc-mock'
import { makeTableDataTabState } from '../../helpers/table-data-test-utils'

const TAB_ID = 'tab-1'

function column(name: string, overrides: Partial<TableDataColumnMeta> = {}): TableDataColumnMeta {
  return {
    name: name,
    dataType: 'int',
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

const COLUMNS = [
  column('id', { isPrimaryKey: true }),
  column('payload', { dataType: 'blob', isBinary: true, isNullable: true }),
]
const BINARY_KEY_COLUMNS = [
  column('hash', { dataType: 'binary', isBinary: true, isPrimaryKey: true }),
]
const ROW = { id: 1, payload: null }

function renderBlobViewer(columns: TableDataColumnMeta[], primaryKeyColumns: string[]) {
  return renderHook(() =>
    useBlobViewerState({
      tabId: TAB_ID,
      columns: columns,
      primaryKeyColumns: primaryKeyColumns,
    })
  )
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

describe('useBlobViewerState', () => {
  it('opens a target with the resolved primary key and loads the blob through IPC', async () => {
    const { result } = renderBlobViewer(COLUMNS, ['id'])

    act(() => result.current.openBlobViewer('payload', ROW))

    expect(result.current.blobViewerTarget).toEqual({
      columnKey: 'payload',
      rowData: ROW,
      primaryKeyPairs: [['id', 1]],
    })

    await act(async () => {
      await result.current.loadBlob()
    })

    expect(ipc.calls('fetch_blob_value')).toContainEqual({
      connectionId: 'conn-1',
      database: 'mydb',
      table: 'users',
      column: 'payload',
      pkPairs: [['id', 1]],
    })
  })

  it('stages an applied envelope on the target row', () => {
    const { result } = renderBlobViewer(COLUMNS, ['id'])
    act(() => result.current.openBlobViewer('payload', ROW))

    act(() => result.current.applyBlob({ __sqllumen_blob__: true, kind: 'empty' }))

    const editState = useTableDataStore.getState().tabs[TAB_ID]?.editState
    expect(editState?.modifiedColumns.has('payload')).toBe(true)
  })

  it('closes the target', () => {
    const { result } = renderBlobViewer(COLUMNS, ['id'])
    act(() => result.current.openBlobViewer('payload', ROW))

    act(() => result.current.closeBlobViewer())

    expect(result.current.blobViewerTarget).toBeNull()
  })

  it('refuses to load or apply without an open target', () => {
    const { result } = renderBlobViewer(COLUMNS, ['id'])

    expect(() => result.current.loadBlob()).toThrow(
      'Cannot load BLOB without a resolvable primary key'
    )
    act(() => result.current.applyBlob({ __sqllumen_blob__: true, kind: 'null' }))
    expect(useTableDataStore.getState().tabs[TAB_ID]?.editState).toBeNull()
  })

  it('shows an error when the primary key cannot be converted', () => {
    const { result } = renderBlobViewer(BINARY_KEY_COLUMNS, ['hash'])

    act(() => result.current.openBlobViewer('payload', { hash: '0xZZ' }))

    expect(result.current.blobViewerTarget).toBeNull()
    expectToast('error', 'Could not open BLOB viewer')
  })
})
