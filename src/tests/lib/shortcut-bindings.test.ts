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
})
