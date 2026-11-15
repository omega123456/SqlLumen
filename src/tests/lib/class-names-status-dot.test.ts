import { describe, expect, it } from 'vitest'
import { statusDotClassName } from '../../lib/class-names-status-dot'

describe('statusDotClassName', () => {
  it('styles successful and failed outcomes differently', () => {
    expect(statusDotClassName(true)).not.toBe(statusDotClassName(false))
  })

  it('returns a stable class for the same outcome', () => {
    expect(statusDotClassName(true)).toBe(statusDotClassName(true))
    expect(statusDotClassName(false)).toBe(statusDotClassName(false))
  })
})
