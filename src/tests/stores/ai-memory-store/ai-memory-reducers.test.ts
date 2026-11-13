import { describe, expect, it } from 'vitest'
import { putReembedStatus } from '../../../stores/ai-memory-store/ai-memory-reducers'

describe('ai memory reducers', () => {
  it('stores the re-embed status of one owner and keeps the others', () => {
    const idle = { status: 'idle' as const, done: 0, total: 0 }
    const running = { status: 'running' as const, done: 1, total: 4 }
    const updated = putReembedStatus(
      { reembedStatus: { global: idle } },
      { ownerKey: 'conn-1', status: running }
    )
    expect(updated.reembedStatus).toEqual({ global: idle, 'conn-1': running })
  })
})
