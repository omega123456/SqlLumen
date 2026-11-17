import { describe, expect, it } from 'vitest'
import { dataFlag } from '../../lib/data-attributes'

describe('dataFlag', () => {
  it('is true for a set flag', () => {
    expect(dataFlag(true)).toBe(true)
  })
})
