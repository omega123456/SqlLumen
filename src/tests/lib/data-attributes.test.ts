import { describe, expect, it } from 'vitest'
import { dataFlag } from '../../lib/data-attributes'

describe('dataFlag', () => {
  it('is true for a set flag', () => {
    expect(dataFlag(true)).toBe(true)
  })

  it('is undefined for an unset flag so the attribute is omitted', () => {
    expect(dataFlag(false)).toBeUndefined()
  })
})
