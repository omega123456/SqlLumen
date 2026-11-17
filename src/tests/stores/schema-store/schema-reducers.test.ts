import { describe, expect, it } from 'vitest'
import {
  isCurrentLoadGeneration,
  nextRevealRequest,
  patchConnectionTree,
  removeConnectionTree,
} from '../../../stores/schema-store/schema-reducers'
import { createDefaultConnectionState } from '../../../stores/schema-store/connection-tree'

describe('schema reducers', () => {
  it('patches a connection tree, creating it when missing', () => {
    const patched = patchConnectionTree(
      { connectionStates: {} },
      { connectionId: 'conn', patch: { filterText: 'orders' } }
    )
    expect(patched.connectionStates.conn.filterText).toBe('orders')
    expect(isCurrentLoadGeneration(patched, 'conn', 0)).toBe(true)
    expect(isCurrentLoadGeneration(patched, 'conn', 1)).toBe(false)
  })

  it('numbers successive reveal requests', () => {
    const first = nextRevealRequest({ revealRequest: null }, { connectionId: 'c', nodeId: 'n' })
    expect(first.revealRequest?.seq).toBe(1)
    expect(nextRevealRequest(first, { connectionId: 'c', nodeId: 'n' }).revealRequest?.seq).toBe(2)
  })

  it('removes a connection tree', () => {
    const state = { connectionStates: { conn: createDefaultConnectionState() } }
    expect(removeConnectionTree(state, 'conn')).toEqual({ connectionStates: {} })
  })
})
