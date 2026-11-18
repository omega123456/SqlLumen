import { afterEach, describe, expect, it, vi } from 'vitest'
import { NEVER_CONNECTED_LABEL, lastConnectedLabel } from '../../lib/relative-time'

afterEach(() => {
  vi.useRealTimers()
})

describe('lastConnectedLabel', () => {
  it('describes the time since the last connect, or that there was none', () => {
    vi.useFakeTimers({ now: new Date('2026-06-08T12:00:00Z') })
    expect(lastConnectedLabel('2026-06-08T10:00:00.000000+00:00')).toBe('2 hours ago')
    expect(lastConnectedLabel(null)).toBe(NEVER_CONNECTED_LABEL)
  })
})
