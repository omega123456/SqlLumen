import { describe, expect, it } from 'vitest'
import { bindingsMatch } from '../../lib/shortcut-bindings'

describe('bindingsMatch', () => {
  it('ignores key case and modifier order', () => {
    expect(
      bindingsMatch(
        { key: 'k', modifiers: ['ctrl', 'shift'] },
        { key: 'K', modifiers: ['shift', 'ctrl'] }
      )
    ).toBe(true)
  })

  it('rejects a different key', () => {
    expect(
      bindingsMatch({ key: 'k', modifiers: ['ctrl'] }, { key: 'j', modifiers: ['ctrl'] })
    ).toBe(false)
  })

  it('rejects a different number of modifiers', () => {
    expect(
      bindingsMatch({ key: 'k', modifiers: ['ctrl'] }, { key: 'k', modifiers: ['ctrl', 'shift'] })
    ).toBe(false)
  })

  it('rejects different modifiers of the same count', () => {
    expect(bindingsMatch({ key: 'k', modifiers: ['ctrl'] }, { key: 'k', modifiers: ['alt'] })).toBe(
      false
    )
  })
})
