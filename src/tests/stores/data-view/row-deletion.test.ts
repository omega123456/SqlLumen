import { describe, it, expect, vi } from 'vitest'
import { ipc, expectToast } from '../../ipc-mock'
import { useQueryStore, activeQuerySurfaceRef, type ResultPatch } from '../../../stores/query-store'
import { useToastStore } from '../../../stores/toast-store'
import { flat, withRows } from '../../helpers/query-test-utils'
import { patchResult, registerQueryStoreSetup } from '../../helpers/query-store-fixtures'

registerQueryStoreSetup()

describe('deleteResultRows', () => {
  const editMetadata = {
    users: {
      database: 'testdb',
      table: 'users',
      columns: [],
      primaryKey: { keyColumns: ['id'], hasAutoIncrement: true, isUniqueKeyFallback: false },
      foreignKeys: [],
    },
  }
  const ROWS = [
    [1, 'a'],
    [2, 'b'],
    [3, 'c'],
  ]

  // An edit-mode result bound to `users` with `id` (result column 0) as its key.
  function setupEditableResult(tabId: string, overrides: ResultPatch = {}) {
    useQueryStore.getState().setContent(tabId, 'SELECT id, name FROM users')
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        [tabId]: { ...prev.tabs[tabId]!, connectionId: 'conn-1' },
      },
    }))
    patchResult(tabId, {
      view: {
        slot: {
          columns: [
            { name: 'id', dataType: 'INT' },
            { name: 'name', dataType: 'VARCHAR' },
          ],
          queryId: 'q-del',
          totalRows: 3,
          viewVersion: 1,
          connectionId: 'conn-1',
        },
        selection: { rowIndex: 1 },
        editTarget: {
          tableName: 'users',
          tables: editMetadata,
          boundIndexByName: new Map([
            ['id', 0],
            ['name', 1],
          ]),
        },
        checked: {
          ranges: [
            [0, 1],
            [2, 3],
          ],
          viewVersion: 1,
        },
      },
      ...withRows(ROWS),
      latestKnownViewVersion: 1,
      lastExecutedSql: 'SELECT id, name FROM users',
    })
    patchResult(tabId, overrides)
  }

  function removedResponse() {
    ipc.overridePayload('remove_result_rows', (args) => {
      const removed = (args?.baseIndices as number[]).length
      return { viewVersion: 2, viewRowCount: 3 - removed, totalRows: 3 - removed }
    })
  }

  it('deletes checked rows by key, tombstones exactly those base indices, and never re-runs', async () => {
    ipc.override('delete_table_row', () => undefined)
    removedResponse()
    setupEditableResult('tab-del')

    const count = await useQueryStore.getState().deleteResultRows(activeQuerySurfaceRef('tab-del'))

    expect(count).toBe(2)
    const calls = ipc.payloads('delete_table_row') as Array<Record<string, unknown>>
    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({
      database: 'testdb',
      table: 'users',
      primaryKeyColumns: ['id'],
      primaryKeyValues: { id: 1 },
    })
    expect(calls[1]).toMatchObject({ primaryKeyValues: { id: 3 } })
    expect(ipc.payloads('remove_result_rows')[0]).toEqual({
      connectionId: 'conn-1',
      tabId: 'tab-del',
      resultIndex: 0,
      queryId: 'q-del',
      baseViewVersion: 1,
      baseIndices: [0, 2],
    })
    // D16: no re-execute after a delete.
    expect(ipc.payloads('execute_query')).toHaveLength(0)
    expect(ipc.payloads('reexecute_single_result')).toHaveLength(0)

    const result = flat('tab-del')
    expect(result.view.slot.totalRows).toBe(1)
    expect(result.view.slot.viewRowCount).toBe(1)
    expect(result.view.slot.viewVersion).toBe(2)
    expect(result.view.selection.rowIndex).toBeNull()
    expect(result.view.checked.ranges).toEqual([])
    await expectToast('success', 'Rows deleted')
  })

  it('resolves unloaded checked rows (header select-all) to base indices before deleting', async () => {
    ipc.override('delete_table_row', () => undefined)
    removedResponse()
    // The view is sorted: positions map to base indices 2, 0, 1. Only the first row is loaded.
    setupEditableResult('tab-del-sel', {
      ...withRows([[3, 'c']]),
      view: { slot: { viewRowCount: 3 }, checked: { ranges: [[0, 3]] } },
    })
    ipc.override('fetch_result_window', () => ({
      offset: 0,
      rows: [
        [3, 'c'],
        [1, 'a'],
        [2, 'b'],
      ],
      baseIndices: [2, 0, 1],
      viewRowCount: 3,
      viewVersion: 1,
    }))

    await useQueryStore.getState().deleteResultRows(activeQuerySurfaceRef('tab-del-sel'))

    expect(ipc.payloads('fetch_result_window')).toHaveLength(1)
    expect(ipc.payloads('remove_result_rows')[0]).toMatchObject({ baseIndices: [2, 0, 1] })
  })

  it('retries a superseded tombstone write once against the current version', async () => {
    ipc.override('delete_table_row', () => undefined)
    let attempt = 0
    ipc.override('remove_result_rows', () => {
      attempt += 1
      if (attempt === 1) throw new Error('view_superseded: current=5')
      return { viewVersion: 6, viewRowCount: 1, totalRows: 1 }
    })
    setupEditableResult('tab-del-cas')

    await useQueryStore.getState().deleteResultRows(activeQuerySurfaceRef('tab-del-cas'))

    const calls = ipc.payloads('remove_result_rows') as Array<Record<string, unknown>>
    expect(calls.map((call) => call.baseViewVersion)).toEqual([1, 5])
    expect(flat('tab-del-cas').view.slot.viewVersion).toBe(6)
  })

  it('never repaints a tombstone response older than the view already painted', async () => {
    // A sort committed on top of the tombstones (v3) and painted while the
    // delete's own response (v2) was still in flight.
    ipc.override('delete_table_row', () => {
      patchResult('tab-del-late', {
        view: { slot: { viewVersion: 3 } },
        latestKnownViewVersion: 3,
      })
      return undefined
    })
    ipc.override('remove_result_rows', () => ({ viewVersion: 2, viewRowCount: 1, totalRows: 1 }))
    setupEditableResult('tab-del-late')

    await useQueryStore.getState().deleteResultRows(activeQuerySurfaceRef('tab-del-late'))

    const result = flat('tab-del-late')
    expect(result.view.slot.viewVersion).toBe(3)
    expect(result.view.checked.ranges).toEqual([])
    expect(result.view.edit.state).toBeNull()
    await expectToast('success', 'Rows deleted')
  })

  it('marks the result stale with the Refresh failed toast when remove_result_rows fails', async () => {
    ipc.override('delete_table_row', () => undefined)
    ipc.override('remove_result_rows', () => {
      throw new Error('cache write failed')
    })
    setupEditableResult('tab-del-stale')

    const count = await useQueryStore
      .getState()
      .deleteResultRows(activeQuerySurfaceRef('tab-del-stale'))

    expect(count).toBe(2)
    expect(flat('tab-del-stale').view.edit.isStale).toBe(true)
    expect(flat('tab-del-stale').view.checked.ranges).toEqual([])
    await expectToast(
      'error',
      "2 rows deleted, but the result couldn't be updated. Re-run the query to refresh."
    )
    expect(ipc.payloads('execute_query')).toHaveLength(0)
  })

  it('treats a second superseded refusal like any other tombstone failure', async () => {
    ipc.override('delete_table_row', () => undefined)
    ipc.override('remove_result_rows', () => {
      throw new Error('view_superseded: current=9')
    })
    setupEditableResult('tab-del-cas2')

    await useQueryStore.getState().deleteResultRows(activeQuerySurfaceRef('tab-del-cas2'))

    expect(ipc.payloads('remove_result_rows')).toHaveLength(2)
    expect(flat('tab-del-cas2').view.edit.isStale).toBe(true)
  })

  it('refuses to delete and warns when the result is not in edit mode', async () => {
    ipc.override('delete_table_row', () => undefined)
    setupEditableResult('tab-del-ro', {
      view: { editTarget: { tableName: null } },
    })

    const count = await useQueryStore
      .getState()
      .deleteResultRows(activeQuerySurfaceRef('tab-del-ro'))

    expect(count).toBe(0)
    expect(ipc.payloads('delete_table_row')).toHaveLength(0)
    await expectToast('error', 'Enable edit mode')
  })

  it('refuses when the table has no key, or there is no edit connection', async () => {
    ipc.override('delete_table_row', () => undefined)
    setupEditableResult('tab-del-nopk', {
      view: { editTarget: { tables: { users: { ...editMetadata.users, primaryKey: null } } } },
    })
    expect(
      await useQueryStore.getState().deleteResultRows(activeQuerySurfaceRef('tab-del-nopk'))
    ).toBe(0)
    await expectToast('error', 'no primary or unique key')

    setupEditableResult('tab-del-noconn', {
      view: { slot: { connectionId: '' } },
    })
    expect(
      await useQueryStore.getState().deleteResultRows(activeQuerySurfaceRef('tab-del-noconn'))
    ).toBe(0)
    await expectToast('error', 'No active connection')
    expect(ipc.payloads('delete_table_row')).toHaveLength(0)
  })

  it('refuses to delete when the key columns are absent from the result set', async () => {
    ipc.override('delete_table_row', () => undefined)
    setupEditableResult('tab-del-nokey', {
      view: { editTarget: { boundIndexByName: new Map([['name', 1]]) } },
    })

    const count = await useQueryStore
      .getState()
      .deleteResultRows(activeQuerySurfaceRef('tab-del-nokey'))

    expect(count).toBe(0)
    expect(ipc.payloads('delete_table_row')).toHaveLength(0)
    await expectToast('error', 'key columns')
  })

  it('deletes nothing for checked ranges of an older view, or above the 10,000-row cap', async () => {
    ipc.override('delete_table_row', () => undefined)
    setupEditableResult('tab-del-old', {
      view: { checked: { viewVersion: 0 } },
    })
    expect(
      await useQueryStore.getState().deleteResultRows(activeQuerySurfaceRef('tab-del-old'))
    ).toBe(0)
    expect(flat('tab-del-old').view.checked.ranges).toEqual([])

    setupEditableResult('tab-del-cap', {
      view: { slot: { viewRowCount: 100_000 }, checked: { ranges: [[0, 100_000]] } },
    })
    expect(
      await useQueryStore.getState().deleteResultRows(activeQuerySurfaceRef('tab-del-cap'))
    ).toBe(0)
    expect(ipc.payloads('delete_table_row')).toHaveLength(0)
    expect(ipc.payloads('fetch_result_window')).toHaveLength(0)
  })

  it('shows Delete failed and deletes nothing when the checked rows cannot be loaded', async () => {
    ipc.override('delete_table_row', () => undefined)
    ipc.override('fetch_result_window', () => {
      throw new Error('offline')
    })
    setupEditableResult('tab-del-load', {
      ...withRows([]),
      view: { slot: { viewRowCount: 3 }, checked: { ranges: [[0, 3]] } },
    })

    expect(
      await useQueryStore.getState().deleteResultRows(activeQuerySurfaceRef('tab-del-load'))
    ).toBe(0)
    expect(ipc.payloads('delete_table_row')).toHaveLength(0)
    await expectToast('error', 'offline')
  })

  it('routes results_expired while loading checked rows to the expired block', async () => {
    ipc.override('fetch_result_window', () => {
      throw new Error('results_expired: gone')
    })
    setupEditableResult('tab-del-exp', {
      ...withRows([]),
      view: { slot: { viewRowCount: 3 }, checked: { ranges: [[0, 3]] } },
    })

    expect(
      await useQueryStore.getState().deleteResultRows(activeQuerySurfaceRef('tab-del-exp'))
    ).toBe(0)
    expect(flat('tab-del-exp').view.residency.isExpired).toBe(true)
  })

  it('stops on the first failed delete and tombstones only the deleted subset', async () => {
    let callCount = 0
    ipc.override('delete_table_row', () => {
      callCount += 1
      if (callCount === 2) throw new Error('FK constraint')
      return undefined
    })
    removedResponse()
    useToastStore.setState({ toasts: [] })
    setupEditableResult('tab-del-err')

    const count = await useQueryStore
      .getState()
      .deleteResultRows(activeQuerySurfaceRef('tab-del-err'))

    expect(count).toBe(1)
    expect(ipc.payloads('remove_result_rows')[0]).toMatchObject({ baseIndices: [0] })
    const result = flat('tab-del-err')
    expect(result.view.edit.saveError).toBe('FK constraint')
    await expectToast('error', 'FK constraint')
    // The failure already surfaced an error toast; no "Rows deleted" success.
    expect(
      useToastStore
        .getState()
        .toasts.some((toast) => toast.variant === 'success' && toast.title === 'Rows deleted')
    ).toBe(false)
  })

  it('records the error and tombstones nothing when the first delete fails', async () => {
    ipc.override('delete_table_row', () => {
      throw new Error('access denied')
    })
    setupEditableResult('tab-del-first-err')

    const count = await useQueryStore
      .getState()
      .deleteResultRows(activeQuerySurfaceRef('tab-del-first-err'))

    expect(count).toBe(0)
    expect(ipc.payloads('remove_result_rows')).toHaveLength(0)
    const result = flat('tab-del-first-err')
    expect(result.rows).toHaveLength(3)
    expect(result.view.edit.saveError).toBe('access denied')
    await expectToast('error', 'access denied')
  })

  it('deletes the selected row when nothing is checked', async () => {
    ipc.override('delete_table_row', () => undefined)
    removedResponse()
    setupEditableResult('tab-del-selected', {
      view: { checked: { ranges: [] } },
    })

    const count = await useQueryStore
      .getState()
      .deleteResultRows(activeQuerySurfaceRef('tab-del-selected'))

    expect(count).toBe(1)
    const calls = ipc.payloads('delete_table_row') as Array<Record<string, unknown>>
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ primaryKeyValues: { id: 2 } })
    expect(ipc.payloads('remove_result_rows')[0]).toMatchObject({ baseIndices: [1] })
  })

  it('no-ops when nothing is checked and no row is selected', async () => {
    ipc.override('delete_table_row', () => undefined)
    setupEditableResult('tab-del-empty', {
      view: { checked: { ranges: [] }, selection: { rowIndex: null } },
    })

    const count = await useQueryStore
      .getState()
      .deleteResultRows(activeQuerySurfaceRef('tab-del-empty'))
    expect(count).toBe(0)
    expect(ipc.payloads('delete_table_row')).toHaveLength(0)
    expect(flat('tab-del-empty').rows).toHaveLength(3)
  })

  it('reports "Deleting… done of n" progress through beginRowAction after 1 s', async () => {
    vi.useFakeTimers()
    try {
      let release: (() => void) | undefined
      ipc.override(
        'delete_table_row',
        () =>
          new Promise<void>((resolve) => {
            release = resolve
          })
      )
      removedResponse()
      setupEditableResult('tab-del-progress', {
        view: { checked: { ranges: [[0, 1]] } },
      })

      const deletion = useQueryStore
        .getState()
        .deleteResultRows(activeQuerySurfaceRef('tab-del-progress'))
      await vi.advanceTimersByTimeAsync(0)
      expect(flat('tab-del-progress').view.rowAction).toMatchObject({
        verb: 'Deleting',
        total: 1,
        visible: false,
        cancellable: false,
      })
      await vi.advanceTimersByTimeAsync(1000)
      expect(flat('tab-del-progress').view.rowAction?.visible).toBe(true)
      release?.()
      await vi.advanceTimersByTimeAsync(0)
      await deletion
      expect(flat('tab-del-progress').view.rowAction).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
