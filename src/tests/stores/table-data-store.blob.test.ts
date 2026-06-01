import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from '@testing-library/react'
import { ipc } from '../ipc-mock'
import { useTableDataStore } from '../../stores/table-data-store'
import {
  bytesEnvelope,
  emptyEnvelope,
  nullEnvelope,
  isBlobEnvelope,
  base64ToBytes,
} from '../../lib/blob-utils'
import * as toastStore from '../../stores/toast-store'
import type { PrimaryKeyInfo, TableDataColumnMeta, TableDataResponse } from '../../types/schema'

// "hi" → base64 "aGk=" (2 bytes)
const TWO_BYTE_BASE64 = 'aGk='

const columns: TableDataColumnMeta[] = [
  {
    name: 'id',
    dataType: 'INT',
    isBooleanAlias: false,
    isNullable: false,
    isPrimaryKey: true,
    isUniqueKey: false,
    hasDefault: false,
    columnDefault: null,
    isBinary: false,
    isAutoIncrement: true,
  },
  {
    name: 'photo',
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

const primaryKey: PrimaryKeyInfo = {
  keyColumns: ['id'],
  hasAutoIncrement: true,
  isUniqueKeyFallback: false,
}

const response: TableDataResponse = {
  columns,
  rows: [
    [1, '[BLOB - 5 bytes]'],
    [2, '[BLOB - 9 bytes]'],
  ],
  currentPage: 1,
  pageSize: 1000,
  primaryKey,
  executionTimeMs: 1,
}

const TAB_ID = 'blob-tab'

async function setupTab(): Promise<void> {
  ipc.override('fetch_table_data', () => response)
  await act(async () => {
    useTableDataStore.getState().initTab(TAB_ID, 'conn-1', 'db', 'photos')
    await useTableDataStore.getState().loadTableData(TAB_ID)
  })
}

function getTab() {
  const tab = useTableDataStore.getState().tabs[TAB_ID]
  if (!tab) throw new Error('tab missing')
  return tab
}

describe('table-data-store blob staging', () => {
  beforeEach(() => {
    useTableDataStore.setState({ tabs: {} })
  })

  it('stages a bytes envelope verbatim, marks the row dirty, and shows it in the row', async () => {
    await setupTab()
    const rowData = { id: 1, photo: '[BLOB - 5 bytes]' }

    act(() => {
      useTableDataStore
        .getState()
        .stageBlobEnvelope(TAB_ID, rowData, 'photo', bytesEnvelope(TWO_BYTE_BASE64))
    })

    const tab = getTab()
    expect(tab.editState).not.toBeNull()
    expect(tab.editState?.modifiedColumns.has('photo')).toBe(true)
    expect(isBlobEnvelope(tab.editState?.currentValues.photo)).toBe(true)
    // The envelope is reflected in the in-memory row for grid rendering.
    expect(isBlobEnvelope(tab.rows[0][1])).toBe(true)
  })

  it('includes the envelope verbatim in the UPDATE payload', async () => {
    await setupTab()
    const rowData = { id: 1, photo: '[BLOB - 5 bytes]' }
    const envelope = bytesEnvelope(TWO_BYTE_BASE64)

    let captured: Record<string, unknown> | null = null
    ipc.override('update_table_row', (args) => {
      captured = (args?.updatedValues as Record<string, unknown>) ?? null
      return undefined
    })

    act(() => {
      useTableDataStore.getState().stageBlobEnvelope(TAB_ID, rowData, 'photo', envelope)
    })
    await act(async () => {
      await useTableDataStore.getState().saveCurrentRow(TAB_ID)
    })

    expect(captured).not.toBeNull()
    expect(captured!.photo).toEqual(envelope)
  })

  it('includes the envelope verbatim in the INSERT payload', async () => {
    await setupTab()
    const envelope = bytesEnvelope(TWO_BYTE_BASE64)

    let captured: Record<string, unknown> | null = null
    ipc.override('insert_table_row', (args) => {
      captured = (args?.values as Record<string, unknown>) ?? null
      return [
        ['id', 3],
        ['photo', '[BLOB - 2 bytes]'],
      ]
    })

    act(() => {
      useTableDataStore.getState().insertNewRow(TAB_ID)
    })
    const tempId = getTab().editState?.tempId
    const lastIdx = getTab().rows.length - 1
    const draftRow = getTab().rows[lastIdx]
    // Mirror the record the grid builds for the editing draft row.
    const draftRowData = {
      __tempId: tempId,
      __rowIndex: lastIdx,
      id: draftRow[0],
      photo: draftRow[1],
    }

    act(() => {
      useTableDataStore.getState().stageBlobEnvelope(TAB_ID, draftRowData, 'photo', envelope)
    })
    await act(async () => {
      await useTableDataStore.getState().saveCurrentRow(TAB_ID)
    })

    expect(captured).not.toBeNull()
    expect(captured!.photo).toEqual(envelope)
  })

  it('reconciles a saved bytes envelope to a clean placeholder (no asterisk)', async () => {
    await setupTab()
    const rowData = { id: 1, photo: '[BLOB - 5 bytes]' }
    ipc.override('update_table_row', () => undefined)

    act(() => {
      useTableDataStore
        .getState()
        .stageBlobEnvelope(TAB_ID, rowData, 'photo', bytesEnvelope(TWO_BYTE_BASE64))
    })
    await act(async () => {
      await useTableDataStore.getState().saveCurrentRow(TAB_ID)
    })

    const tab = getTab()
    expect(tab.editState).toBeNull()
    expect(tab.rows[0][1]).toBe('[BLOB - 2 B]')
  })

  it('reconciles a saved empty envelope to [BLOB - 0 B]', async () => {
    await setupTab()
    const rowData = { id: 1, photo: '[BLOB - 5 bytes]' }
    ipc.override('update_table_row', () => undefined)

    act(() => {
      useTableDataStore.getState().stageBlobEnvelope(TAB_ID, rowData, 'photo', emptyEnvelope())
    })
    await act(async () => {
      await useTableDataStore.getState().saveCurrentRow(TAB_ID)
    })

    expect(getTab().rows[0][1]).toBe('[BLOB - 0 B]')
  })

  it('reconciles a saved null envelope to null', async () => {
    await setupTab()
    const rowData = { id: 1, photo: '[BLOB - 5 bytes]' }
    ipc.override('update_table_row', () => undefined)

    act(() => {
      useTableDataStore.getState().stageBlobEnvelope(TAB_ID, rowData, 'photo', nullEnvelope())
    })
    await act(async () => {
      await useTableDataStore.getState().saveCurrentRow(TAB_ID)
    })

    expect(getTab().rows[0][1]).toBeNull()
  })

  it('is a no-op for an unknown column', async () => {
    await setupTab()
    act(() => {
      useTableDataStore.getState().stageBlobEnvelope(TAB_ID, { id: 1 }, 'missing', nullEnvelope())
    })
    expect(getTab().editState).toBeNull()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })
})

// ---------------------------------------------------------------------------
// Binary primary-key WHERE-clause envelope conversion (Phase 2)
// ---------------------------------------------------------------------------

const BINARY_PK_TAB = 'binary-pk-tab'

function makeColumn(
  name: string,
  dataType: string,
  overrides: Partial<TableDataColumnMeta> = {}
): TableDataColumnMeta {
  return {
    name,
    dataType,
    isBooleanAlias: false,
    isNullable: false,
    isPrimaryKey: false,
    isUniqueKey: false,
    hasDefault: false,
    columnDefault: null,
    isBinary: false,
    isAutoIncrement: false,
    ...overrides,
  }
}

function assertBytesEnvelope(value: unknown, expectedHex: string): void {
  expect(isBlobEnvelope(value)).toBe(true)
  const envelope = value as { kind: string; base64: string }
  expect(envelope.kind).toBe('bytes')
  const hex = Array.from(base64ToBytes(envelope.base64))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  expect(hex.toLowerCase()).toBe(expectedHex.toLowerCase())
}

async function setupBinaryPkTab(
  binaryColumns: TableDataColumnMeta[],
  keyColumns: string[],
  rows: unknown[][]
): Promise<void> {
  const pkResponse: TableDataResponse = {
    columns: binaryColumns,
    rows,
    currentPage: 1,
    pageSize: 1000,
    primaryKey: { keyColumns, hasAutoIncrement: false, isUniqueKeyFallback: false },
    executionTimeMs: 1,
  }
  ipc.override('fetch_table_data', () => pkResponse)
  await act(async () => {
    useTableDataStore.getState().initTab(BINARY_PK_TAB, 'conn-1', 'db', 'binkeyed')
    await useTableDataStore.getState().loadTableData(BINARY_PK_TAB)
  })
}

function getBinaryPkTab() {
  const tab = useTableDataStore.getState().tabs[BINARY_PK_TAB]
  if (!tab) throw new Error('tab missing')
  return tab
}

describe('table-data-store binary primary-key conversion', () => {
  beforeEach(() => {
    useTableDataStore.setState({ tabs: {} })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends a bytes envelope (not the 0x string) as originalPkValues on update', async () => {
    const binCols = [
      makeColumn('uid', 'BINARY(16)', { isPrimaryKey: true, isBinary: true }),
      makeColumn('label', 'VARCHAR(64)'),
    ]
    await setupBinaryPkTab(binCols, ['uid'], [['0xDEADBEEF', 'old-label']])

    let captured: Record<string, unknown> | null = null
    ipc.override('update_table_row', (args) => {
      captured = (args?.originalPkValues as Record<string, unknown>) ?? null
      return undefined
    })

    act(() => {
      useTableDataStore
        .getState()
        .startEditing(BINARY_PK_TAB, { uid: '0xDEADBEEF' }, { uid: '0xDEADBEEF', label: 'old-label' })
      useTableDataStore.getState().updateCellValue(BINARY_PK_TAB, 'label', 'new-label')
    })
    await act(async () => {
      await useTableDataStore.getState().saveCurrentRow(BINARY_PK_TAB)
    })

    expect(captured).not.toBeNull()
    assertBytesEnvelope(captured!.uid, 'deadbeef')
  })

  it('sends a bytes envelope as pkValues on delete and removes the row (C5)', async () => {
    const binCols = [
      makeColumn('uid', 'VARBINARY(16)', { isPrimaryKey: true, isBinary: true }),
      makeColumn('label', 'VARCHAR(64)'),
    ]
    await setupBinaryPkTab(
      binCols,
      ['uid'],
      [
        ['0xAABB', 'row-a'],
        ['0xCCDD', 'row-b'],
      ]
    )

    let captured: Record<string, unknown> | null = null
    ipc.override('delete_table_row', (args) => {
      captured = (args?.pkValues as Record<string, unknown>) ?? null
      return undefined
    })

    await act(async () => {
      await useTableDataStore.getState().deleteRow(BINARY_PK_TAB, { uid: '0xAABB' })
    })

    expect(captured).not.toBeNull()
    assertBytesEnvelope(captured!.uid, 'aabb')
    const tab = getBinaryPkTab()
    expect(tab.rows).toHaveLength(1)
    expect(tab.rows[0][0]).toBe('0xCCDD')
  })

  it('converts only binary components of a composite key (delete)', async () => {
    const cols = [
      makeColumn('tenant_id', 'INT', { isPrimaryKey: true }),
      makeColumn('external_ref', 'VARBINARY(32)', { isPrimaryKey: true, isBinary: true }),
      makeColumn('label', 'VARCHAR(64)'),
    ]
    await setupBinaryPkTab(
      cols,
      ['tenant_id', 'external_ref'],
      [[7, '0x0102', 'row-a']]
    )

    let captured: Record<string, unknown> | null = null
    ipc.override('delete_table_row', (args) => {
      captured = (args?.pkValues as Record<string, unknown>) ?? null
      return undefined
    })

    await act(async () => {
      await useTableDataStore
        .getState()
        .deleteRow(BINARY_PK_TAB, { tenant_id: 7, external_ref: '0x0102' })
    })

    expect(captured).not.toBeNull()
    expect(captured!.tenant_id).toBe(7)
    assertBytesEnvelope(captured!.external_ref, '0102')
  })

  it('leaves non-binary PK payloads unchanged (no regression)', async () => {
    const cols = [
      makeColumn('id', 'INT', { isPrimaryKey: true }),
      makeColumn('label', 'VARCHAR(64)'),
    ]
    await setupBinaryPkTab(cols, ['id'], [[42, 'old-label']])

    let updatePk: Record<string, unknown> | null = null
    ipc.override('update_table_row', (args) => {
      updatePk = (args?.originalPkValues as Record<string, unknown>) ?? null
      return undefined
    })
    let deletePk: Record<string, unknown> | null = null
    ipc.override('delete_table_row', (args) => {
      deletePk = (args?.pkValues as Record<string, unknown>) ?? null
      return undefined
    })

    act(() => {
      useTableDataStore
        .getState()
        .startEditing(BINARY_PK_TAB, { id: 42 }, { id: 42, label: 'old-label' })
      useTableDataStore.getState().updateCellValue(BINARY_PK_TAB, 'label', 'new-label')
    })
    await act(async () => {
      await useTableDataStore.getState().saveCurrentRow(BINARY_PK_TAB)
    })
    expect(updatePk).toEqual({ id: 42 })

    await act(async () => {
      await useTableDataStore.getState().deleteRow(BINARY_PK_TAB, { id: 42 })
    })
    expect(deletePk).toEqual({ id: 42 })
  })

  it('aborts update with a toast and no IPC call on malformed binary PK (C6)', async () => {
    const binCols = [
      makeColumn('uid', 'BINARY(16)', { isPrimaryKey: true, isBinary: true }),
      makeColumn('label', 'VARCHAR(64)'),
    ]
    await setupBinaryPkTab(binCols, ['uid'], [['0xZZZZ', 'old-label']])

    const toastSpy = vi.spyOn(toastStore, 'showErrorToast')
    let called = false
    ipc.override('update_table_row', () => {
      called = true
      return undefined
    })

    act(() => {
      useTableDataStore
        .getState()
        .startEditing(BINARY_PK_TAB, { uid: '0xZZZZ' }, { uid: '0xZZZZ', label: 'old-label' })
      useTableDataStore.getState().updateCellValue(BINARY_PK_TAB, 'label', 'new-label')
    })
    await act(async () => {
      await useTableDataStore.getState().saveCurrentRow(BINARY_PK_TAB)
    })

    expect(called).toBe(false)
    expect(toastSpy).toHaveBeenCalled()
    expect(getBinaryPkTab().saveError).toBeTruthy()
  })

  it('aborts delete with a toast and no IPC call on malformed binary PK (C6)', async () => {
    const binCols = [
      makeColumn('uid', 'BINARY(16)', { isPrimaryKey: true, isBinary: true }),
      makeColumn('label', 'VARCHAR(64)'),
    ]
    await setupBinaryPkTab(binCols, ['uid'], [['0xZZZZ', 'old-label']])

    const toastSpy = vi.spyOn(toastStore, 'showErrorToast')
    let called = false
    ipc.override('delete_table_row', () => {
      called = true
      return undefined
    })

    await act(async () => {
      await useTableDataStore.getState().deleteRow(BINARY_PK_TAB, { uid: '0xZZZZ' })
    })

    expect(called).toBe(false)
    expect(toastSpy).toHaveBeenCalled()
    expect(getBinaryPkTab().error).toBeTruthy()
  })
})
