import { describe, it, expect } from 'vitest'
import { ipc, expectToast } from '../../ipc-mock'
import { bytesEnvelope } from '../../../lib/blob-utils'
import { useQueryStore, activeQuerySurfaceRef } from '../../../stores/query-store'
import { useToastStore } from '../../../stores/toast-store'
import type { QueryTableEditInfo } from '../../../types/schema'
import { flat, firstWindowFor } from '../../helpers/query-test-utils'
import { loadTablePage } from '../../helpers/table-data-test-utils'
import { makeTableColumnMeta } from '../../helpers/column-meta-fixtures'
import { tableSurfaceRef, useTableDataStore } from '../../../stores/table-data-store'
import { setSelectedRow } from '../../../stores/data-view/view-actions'
import { cloneSelectedRow } from '../../../stores/data-view/row-clone'
import { saveCurrentRow } from '../../../stores/data-view/row-save'
import {
  QUERY_STORE_EDIT_COMMANDS,
  executeAndAnalyze,
  flushMicrotasks,
  mockAnalyzeResult,
  mockNaturalAnalyzeResult,
  mockPrimaryKey,
  overrideNamedCommands,
  registerQueryEditStoreSetup,
} from '../../helpers/query-store-fixtures'

registerQueryEditStoreSetup()

// ---------------------------------------------------------------------------
// cloneSelectedRow
// ---------------------------------------------------------------------------

describe('cloneSelectedRow', () => {
  it('creates one unsaved insert draft with blank primary key values and copied non-key values', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')
    useQueryStore.getState().setSelectedRow(activeQuerySurfaceRef('tab-1'), 0)

    useQueryStore.getState().cloneSelectedRow(activeQuerySurfaceRef('tab-1'))

    const tab = flat('tab-1')
    // The draft is a virtual row right after the last view row; cached rows are untouched.
    expect(tab.rows).toHaveLength(2)
    expect(tab.selectedRowIndex).toBe(2)
    expect(tab.editingRowIndex).toBe(2)
    expect(tab.editingBaseIndex).toBeNull()
    expect(tab.draftRow).toEqual([null, 'Alice', 'alice@test.com'])
    expect(tab.editState?.isNewRow).toBe(true)
    expect(tab.editState?.rowKey).toEqual({ id: null })
    expect(tab.editState?.originalValues).toEqual({
      id: null,
      name: 'Alice',
      email: 'alice@test.com',
    })
    expect(tab.editState?.currentValues).toEqual({
      id: null,
      name: 'Alice',
      email: 'alice@test.com',
    })
    expect(tab.editState?.modifiedColumns.has('name')).toBe(true)
    expect(tab.editState?.modifiedColumns.has('email')).toBe(true)
    expect(tab.editState?.modifiedColumns.has('id')).toBe(false)
  })

  it('copies natural primary-key values into the clone instead of leaving them blank', async () => {
    overrideNamedCommands(QUERY_STORE_EDIT_COMMANDS, (cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-natural',
          columns: [
            { name: 'code', dataType: 'VARCHAR' },
            { name: 'name', dataType: 'VARCHAR' },
          ],
          totalRows: 1,
          executionTimeMs: 10,
          affectedRows: 0,
          firstWindow: firstWindowFor([['p-001', 'Alpha']]),

          autoLimitApplied: false,
        }
      }
      if (cmd === 'analyze_query_for_edit') return mockNaturalAnalyzeResult
      if (cmd === 'evict_results') return null
      return null
    })

    await useQueryStore.getState().executeQuery('conn-1', 'tab-1', 'SELECT * FROM projects')
    await flushMicrotasks()
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.projects')
    useQueryStore.getState().setSelectedRow(activeQuerySurfaceRef('tab-1'), 0)
    useQueryStore.getState().cloneSelectedRow(activeQuerySurfaceRef('tab-1'))

    const tab = flat('tab-1')
    expect(tab.draftRow).toEqual(['p-001', 'Alpha'])
    expect(tab.editState?.currentValues.code).toBe('p-001')
    expect(tab.editState?.modifiedColumns.has('code')).toBe(true)
  })

  it('clones the only checkbox-checked row and refuses while several rows are checked', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')

    useQueryStore.getState().setCheckedRanges(activeQuerySurfaceRef('tab-1'), [[0, 2]])
    useQueryStore.getState().cloneSelectedRow(activeQuerySurfaceRef('tab-1'))
    expect(flat('tab-1').draftRow).toBeNull()

    useQueryStore.getState().setCheckedRanges(activeQuerySurfaceRef('tab-1'), [[1, 2]])
    useQueryStore.getState().cloneSelectedRow(activeQuerySurfaceRef('tab-1'))
    expect(flat('tab-1').draftRow).toEqual([null, 'Bob', 'bob@test.com'])
  })

  it('refuses clone when edit metadata is using a unique-key fallback', async () => {
    const fallbackAnalyzeResult: QueryTableEditInfo[] = [
      {
        ...mockAnalyzeResult[0],
        primaryKey: {
          ...mockPrimaryKey,
          isUniqueKeyFallback: true,
        },
      },
    ]

    overrideNamedCommands(QUERY_STORE_EDIT_COMMANDS, (cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-fallback',
          columns: [
            { name: 'id', dataType: 'INT' },
            { name: 'name', dataType: 'VARCHAR' },
            { name: 'email', dataType: 'VARCHAR' },
          ],
          totalRows: 1,
          executionTimeMs: 10,
          affectedRows: 0,
          firstWindow: firstWindowFor([[1, 'Alice', 'alice@test.com']]),

          autoLimitApplied: false,
        }
      }
      if (cmd === 'analyze_query_for_edit') return fallbackAnalyzeResult
      if (cmd === 'evict_results') return null
      return null
    })

    await useQueryStore.getState().executeQuery('conn-1', 'tab-1', 'SELECT * FROM users')
    await flushMicrotasks()
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')
    useQueryStore.getState().setSelectedRow(activeQuerySurfaceRef('tab-1'), 0)

    useQueryStore.getState().cloneSelectedRow(activeQuerySurfaceRef('tab-1'))

    const tab = flat('tab-1')
    expect(tab.rows).toHaveLength(1)
    expect(tab.editState).toBeNull()
    expect(
      useToastStore
        .getState()
        .toasts.some((toast) => toast.message?.includes('unique-key fallback'))
    ).toBe(true)
  })

  it('refuses clone when current row has unsaved edits that would be lost', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')
    useQueryStore.getState().startEditingRow(activeQuerySurfaceRef('tab-1'), 0)
    useQueryStore.getState().syncCellValue(activeQuerySurfaceRef('tab-1'), 1, 'Unsaved')

    const before = flat('tab-1')
    useQueryStore.getState().cloneSelectedRow(activeQuerySurfaceRef('tab-1'))

    const tab = flat('tab-1')
    expect(tab.rows).toEqual(before.rows)
    expect(tab.editingRowIndex).toBe(0)
    expect(tab.editState?.isNewRow).toBe(false)
    expect(tab.editState?.currentValues.name).toBe('Unsaved')
    expect(
      useToastStore
        .getState()
        .toasts.some(
          (toast) => toast.variant === 'error' && toast.message?.includes('Save or discard')
        )
    ).toBe(true)
  })

  it('does not create a clone draft when no non-primary bound columns can produce an insert payload', async () => {
    overrideNamedCommands(QUERY_STORE_EDIT_COMMANDS, (cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-no-clone-path',
          columns: [{ name: 'id', dataType: 'INT' }],
          totalRows: 1,
          executionTimeMs: 5,
          affectedRows: 0,
          firstWindow: firstWindowFor([[1]]),

          autoLimitApplied: false,
        }
      }
      if (cmd === 'analyze_query_for_edit') {
        return [
          {
            database: 'testdb',
            table: 'users',
            columns: [
              {
                name: 'id',
                dataType: 'INT',
                isNullable: false,
                isPrimaryKey: true,
                isUniqueKey: false,
                hasDefault: false,
                columnDefault: null,
                isBinary: false,
                isAutoIncrement: true,
                isBooleanAlias: false,
              },
              {
                name: 'server_only',
                dataType: 'VARCHAR',
                isNullable: true,
                isPrimaryKey: false,
                isUniqueKey: false,
                hasDefault: false,
                columnDefault: null,
                isBinary: false,
                isAutoIncrement: false,
                isBooleanAlias: false,
              },
            ],
            primaryKey: {
              keyColumns: ['id'],
              hasAutoIncrement: true,
              isUniqueKeyFallback: false,
            },
            foreignKeys: [],
          },
        ]
      }
      if (cmd === 'evict_results') return null
      return null
    })

    await useQueryStore.getState().executeQuery('conn-1', 'tab-1', 'SELECT id FROM users')
    await flushMicrotasks()
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')
    useQueryStore.getState().setSelectedRow(activeQuerySurfaceRef('tab-1'), 0)

    useQueryStore.getState().cloneSelectedRow(activeQuerySurfaceRef('tab-1'))

    const tab = flat('tab-1')
    expect(tab.rows).toHaveLength(1)
    expect(tab.editState).toBeNull()
    expect(tab.selectedRowIndex).toBe(0)
  })

  describe('stored BLOB cells', () => {
    const blobTable: QueryTableEditInfo = {
      ...mockAnalyzeResult[0],
      table: 'files',
      columns: [
        mockAnalyzeResult[0].columns[0],
        { ...mockAnalyzeResult[0].columns[1], name: 'photo', dataType: 'BLOB', isBinary: true },
        { ...mockAnalyzeResult[0].columns[1], name: 'scan', dataType: 'BLOB', isBinary: true },
      ],
    }

    async function editFileRow() {
      overrideNamedCommands(QUERY_STORE_EDIT_COMMANDS, (cmd) => {
        if (cmd === 'execute_query') {
          return {
            queryId: 'q-files',
            columns: [
              { name: 'id', dataType: 'INT' },
              { name: 'photo', dataType: 'BLOB' },
              { name: 'scan', dataType: 'BLOB' },
            ],
            totalRows: 1,
            executionTimeMs: 10,
            affectedRows: 0,
            firstWindow: firstWindowFor([[7, '[BLOB - 3 B]', '[BLOB - 20 MB]']]),
            autoLimitApplied: false,
          }
        }
        if (cmd === 'analyze_query_for_edit') return [blobTable]
        return null
      })
      await useQueryStore.getState().executeQuery('conn-1', 'tab-1', 'SELECT * FROM files')
      await flushMicrotasks()
      await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.files')
      useQueryStore.getState().setSelectedRow(activeQuerySurfaceRef('tab-1'), 0)
    }

    it('loads placeholder cells by primary key and leaves BLOBs over 10 MB empty with a warning', async () => {
      await editFileRow()
      ipc.overridePayload('fetch_blob_value', (request) => {
        if (request?.column === 'photo') return { base64: 'U1FM', byteLength: 3, tooLarge: false }
        return { base64: null, byteLength: 20_000_000, tooLarge: true }
      })

      await useQueryStore.getState().cloneSelectedRow(activeQuerySurfaceRef('tab-1'))

      expect(ipc.payloads('fetch_blob_value')).toEqual([
        expect.objectContaining({ column: 'photo', primaryKeyPairs: [['id', 7]] }),
        expect.objectContaining({ column: 'scan', primaryKeyPairs: [['id', 7]] }),
      ])
      const tab = flat('tab-1')
      expect(tab.draftRow).toEqual([null, bytesEnvelope('U1FM'), null])
      expect(tab.editState?.modifiedColumns).toEqual(new Set(['photo']))
      await expectToast('warning', 'Some BLOB values were not copied')
    })

    it('opens no draft and reports an error when a stored BLOB cannot be loaded', async () => {
      await editFileRow()
      ipc.override('fetch_blob_value', () => {
        throw new Error('connection lost')
      })

      await useQueryStore.getState().cloneSelectedRow(activeQuerySurfaceRef('tab-1'))

      expect(flat('tab-1').draftRow).toBeNull()
      await expectToast('error', 'Clone failed')
    })
  })

  describe('stored BLOB cells on the table route', () => {
    const BLOB_TAB_ID = 'tab-blob'
    const BLOB_REF = tableSurfaceRef(BLOB_TAB_ID)

    async function setupTabWithStoredBlob() {
      ipc.override('get_table_foreign_keys', () => [])
      await loadTablePage(BLOB_TAB_ID, {
        columns: [
          makeTableColumnMeta({
            name: 'id',
            dataType: 'bigint',
            isPrimaryKey: true,
            isAutoIncrement: true,
          }),
          makeTableColumnMeta({ name: 'photo', dataType: 'blob', isBinary: true }),
          makeTableColumnMeta({ name: 'total', dataType: 'decimal', isGenerated: true }),
          makeTableColumnMeta({ name: 'caption', dataType: 'varchar' }),
        ],
        rows: [[1, '[BLOB - 3 B]', '9.50', 'beach']],
        primaryKey: { keyColumns: ['id'], hasAutoIncrement: true, isUniqueKeyFallback: false },
      })
      setSelectedRow(BLOB_REF, 0)
    }

    function blobTabEdit() {
      return useTableDataStore.getState().tabs[BLOB_TAB_ID]?.view.edit
    }

    it('copies the stored BLOB bytes into the clone so saving writes the real bytes', async () => {
      await setupTabWithStoredBlob()
      ipc.override('fetch_blob_value', () => ({ base64: 'AQID', byteLength: 3, tooLarge: false }))

      await cloneSelectedRow(BLOB_REF)

      expect(ipc.payloads('fetch_blob_value')).toEqual([
        expect.objectContaining({ column: 'photo', primaryKeyPairs: [['id', 1]] }),
      ])
      expect(blobTabEdit()?.draftRow).toEqual([null, bytesEnvelope('AQID'), null, 'beach'])

      await saveCurrentRow(BLOB_REF)

      expect(ipc.payloads('insert_table_row')).toEqual([
        expect.objectContaining({ values: { photo: bytesEnvelope('AQID'), caption: 'beach' } }),
      ])
    })

    it('leaves a BLOB over the fetch limit out of the clone and warns about it', async () => {
      await setupTabWithStoredBlob()
      ipc.override('fetch_blob_value', () => ({
        base64: null,
        byteLength: 20_000_000,
        tooLarge: true,
      }))

      await cloneSelectedRow(BLOB_REF)

      expect(blobTabEdit()?.draftRow).toEqual([null, null, null, 'beach'])
      expect(blobTabEdit()?.state?.modifiedColumns.has('photo')).toBe(false)
      await expectToast('warning', 'photo')
    })

    it('creates no draft and reports the failure when the BLOB cannot be fetched', async () => {
      await setupTabWithStoredBlob()
      ipc.override('fetch_blob_value', () => {
        throw new Error('connection lost')
      })

      await cloneSelectedRow(BLOB_REF)

      expect(blobTabEdit()?.state).toBeNull()
      await expectToast('error', 'connection lost')
    })
  })
})
