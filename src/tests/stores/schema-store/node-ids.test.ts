import { describe, expect, it } from 'vitest'
import { databaseNodeId, makeNodeId, parseNodeId } from '../../../stores/schema-store/node-ids'

describe('schema node ids', () => {
  it('round-trips names containing separators and unicode', () => {
    const nodeId = makeNodeId('table', 'shop:eu', 'órders:2024')
    expect(parseNodeId(nodeId)).toEqual({ type: 'table', database: 'shop:eu', name: 'órders:2024' })
  })

  it('builds database node ids from the database name', () => {
    expect(parseNodeId(databaseNodeId('shop'))).toEqual({
      type: 'database',
      database: 'shop',
      name: 'shop',
    })
  })
})
