import { describe, expect, it } from 'vitest'
import { shortcutLabelParts } from '../../lib/shortcut-labels'

describe('shortcutLabelParts', () => {
  it('lists modifiers before the key', () => {
    expect(shortcutLabelParts({ key: 'k', modifiers: ['ctrl', 'shift'] })).toEqual([
      'Ctrl',
      'Shift',
      'K',
    ])
    expect(shortcutLabelParts({ key: 'F2', modifiers: ['alt'] })).toEqual(['Alt', 'F2'])
  })

  it('uses short glyphs for arrow, escape, enter and space keys', () => {
    expect(shortcutLabelParts({ key: 'ArrowUp', modifiers: [] })).toEqual(['↑'])
    expect(shortcutLabelParts({ key: 'ArrowDown', modifiers: [] })).toEqual(['↓'])
    expect(shortcutLabelParts({ key: 'Escape', modifiers: [] })).toEqual(['Esc'])
    expect(shortcutLabelParts({ key: 'Enter', modifiers: [] })).toEqual(['Enter'])
    expect(shortcutLabelParts({ key: ' ', modifiers: [] })).toEqual(['Space'])
    expect(shortcutLabelParts({ key: 'Tab', modifiers: [] })).toEqual(['Tab'])
  })
})
