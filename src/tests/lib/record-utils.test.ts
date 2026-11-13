import { describe, expect, it } from 'vitest'
import { withoutKey } from '../../lib/record-utils'

describe('withoutKey', () => {
  it('returns a copy without the key and leaves the source untouched', () => {
    const source = { kept: 1, dropped: 2 }
    expect(withoutKey(source, 'dropped')).toEqual({ kept: 1 })
    expect(source).toEqual({ kept: 1, dropped: 2 })
  })

  it('returns an equal copy when the key is absent', () => {
    expect(withoutKey({ kept: 1 }, 'missing')).toEqual({ kept: 1 })
  })
})
