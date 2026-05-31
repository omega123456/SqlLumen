import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from '@testing-library/react'
import { ipc } from '../ipc-mock'
import { useTableDataStore } from '../../stores/table-data-store'
import { bytesEnvelope, emptyEnvelope, nullEnvelope, isBlobEnvelope } from '../../lib/blob-utils'
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
    expect(tab.rows[0][1]).toBe('[BLOB - 2 bytes]')
  })

  it('reconciles a saved empty envelope to [BLOB - 0 bytes]', async () => {
    await setupTab()
    const rowData = { id: 1, photo: '[BLOB - 5 bytes]' }
    ipc.override('update_table_row', () => undefined)

    act(() => {
      useTableDataStore.getState().stageBlobEnvelope(TAB_ID, rowData, 'photo', emptyEnvelope())
    })
    await act(async () => {
      await useTableDataStore.getState().saveCurrentRow(TAB_ID)
    })

    expect(getTab().rows[0][1]).toBe('[BLOB - 0 bytes]')
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
