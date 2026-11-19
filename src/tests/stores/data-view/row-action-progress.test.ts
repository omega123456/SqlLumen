import { describe, it, expect, vi } from 'vitest'
import { useQueryStore, activeQuerySurfaceRef } from '../../../stores/query-store'
import { flat } from '../../helpers/query-test-utils'
import { patchResult, registerQueryStoreSetup } from '../../helpers/query-store-fixtures'

registerQueryStoreSetup()

describe('row actions', () => {
  it('cancelRowAction calls the cancel hook of a cancellable action once', () => {
    useQueryStore.getState().setContent('tab-act', 'SELECT 1')
    patchResult('tab-act', { queryId: 'q-act' })
    const onCancel = vi.fn()
    const handle = useQueryStore.getState().beginRowAction(activeQuerySurfaceRef('tab-act'), {
      verb: 'Copying',
      total: 5000,
      onCancel: onCancel,
    })
    expect(flat('tab-act').rowActionProgress).toMatchObject({ cancellable: true, total: 5000 })
    handle.update(2000)
    useQueryStore.getState().cancelRowAction(activeQuerySurfaceRef('tab-act'))
    useQueryStore.getState().cancelRowAction(activeQuerySurfaceRef('tab-act'))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(handle.finish()).toBe(false)
    expect(flat('tab-act').rowActionProgress).toBeNull()
  })

  it('updates the visible progress after the 1 s threshold', () => {
    vi.useFakeTimers()
    try {
      useQueryStore.getState().setContent('tab-act2', 'SELECT 1')
      patchResult('tab-act2', { queryId: 'q-act2' })
      const handle = useQueryStore
        .getState()
        .beginRowAction(activeQuerySurfaceRef('tab-act2'), { verb: 'Pasting', total: 4000 })
      vi.advanceTimersByTime(1000)
      handle.update(2000)
      expect(flat('tab-act2').rowActionProgress).toMatchObject({ visible: true, done: 2000 })
      expect(handle.finish()).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('markResultExpired expires only the given result', () => {
    useQueryStore.getState().setContent('tab-exp-one', 'SELECT 1')
    patchResult('tab-exp-one', { queryId: 'q-exp-one' })
    useQueryStore.getState().markResultExpired('tab-exp-one', 0)
    expect(flat('tab-exp-one').isExpired).toBe(true)
    useQueryStore.getState().markResultExpired('missing', 0)
    expect(useQueryStore.getState().tabs.missing).toBeUndefined()
  })
})
