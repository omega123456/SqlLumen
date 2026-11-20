import { describe, it, expect, vi } from 'vitest'
import { useQueryStore, activeQuerySurfaceRef } from '../../../stores/query-store'
import { tableSurfaceRef, useTableDataStore } from '../../../stores/table-data-store'
import { beginRowAction, cancelRowAction } from '../../../stores/data-view/row-action-progress'
import { readView, updateView } from '../../../stores/data-view/route-registry'
import { flat } from '../../helpers/query-test-utils'
import { patchResult, registerQueryStoreSetup } from '../../helpers/query-store-fixtures'
import { makeTableDataTabState } from '../../helpers/table-data-test-utils'

registerQueryStoreSetup()

describe('row actions', () => {
  it('cancelRowAction calls the cancel hook of a cancellable action once', () => {
    useQueryStore.getState().setContent('tab-act', 'SELECT 1')
    patchResult('tab-act', {
      view: { slot: { queryId: 'q-act' } },
    })
    const onCancel = vi.fn()
    const handle = useQueryStore.getState().beginRowAction(activeQuerySurfaceRef('tab-act'), {
      verb: 'Copying',
      total: 5000,
      onCancel: onCancel,
    })
    expect(flat('tab-act').view.rowAction).toMatchObject({ cancellable: true, total: 5000 })
    handle.update(2000)
    cancelRowAction(activeQuerySurfaceRef('tab-act'))
    cancelRowAction(activeQuerySurfaceRef('tab-act'))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(handle.finish()).toBe(false)
    expect(flat('tab-act').view.rowAction).toBeNull()
  })

  it('updates the visible progress after the 1 s threshold', () => {
    vi.useFakeTimers()
    try {
      useQueryStore.getState().setContent('tab-act2', 'SELECT 1')
      patchResult('tab-act2', {
        view: { slot: { queryId: 'q-act2' } },
      })
      const handle = useQueryStore
        .getState()
        .beginRowAction(activeQuerySurfaceRef('tab-act2'), { verb: 'Pasting', total: 4000 })
      vi.advanceTimersByTime(1000)
      handle.update(2000)
      expect(flat('tab-act2').view.rowAction).toMatchObject({ visible: true, done: 2000 })
      expect(handle.finish()).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps table progress through a page swap and clears it when the action finishes', () => {
    useTableDataStore.setState({
      tabs: { 'tbl-act': makeTableDataTabState({ view: { slot: { queryId: 'page-1' } } }) },
    })
    const ref = tableSurfaceRef('tbl-act')
    const handle = beginRowAction(ref, { verb: 'Copying', total: 3000 })
    updateView(ref, { slot: { queryId: 'page-2' } })
    expect(readView(ref)?.rowAction).toMatchObject({ verb: 'Copying', total: 3000 })
    handle.finish()
    expect(readView(ref)?.rowAction).toBeNull()
  })

  it('never lets a replaced action clear the progress of a newer one', () => {
    useQueryStore.getState().setContent('tab-act3', 'SELECT 1')
    patchResult('tab-act3', {
      view: { slot: { queryId: 'q-act3' } },
    })
    const ref = activeQuerySurfaceRef('tab-act3')
    const staleHandle = beginRowAction(ref, { verb: 'Copying', total: 10 })
    updateView(ref, { rowAction: null, slot: { queryId: 'q-act3-rerun' } })
    beginRowAction(ref, { verb: 'Pasting', total: 20 })
    staleHandle.update(5)
    staleHandle.finish()
    expect(readView(ref)?.rowAction).toMatchObject({ verb: 'Pasting', total: 20, done: 0 })
  })

  it('markResultExpired expires only the given result', () => {
    useQueryStore.getState().setContent('tab-exp-one', 'SELECT 1')
    patchResult('tab-exp-one', {
      view: { slot: { queryId: 'q-exp-one' } },
    })
    useQueryStore.getState().markResultExpired('tab-exp-one', 0)
    expect(flat('tab-exp-one').view.residency.isExpired).toBe(true)
    useQueryStore.getState().markResultExpired('missing', 0)
    expect(useQueryStore.getState().tabs.missing).toBeUndefined()
  })
})
