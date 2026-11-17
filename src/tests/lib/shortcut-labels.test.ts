import { describe, expect, it } from 'vitest'
import { menuShortcutLabel, shortcutLabelParts } from '../../lib/shortcut-labels'

describe('shortcutLabelParts', () => {
  it('lists modifiers before the key', () => {
    expect(shortcutLabelParts({ key: 'k', modifiers: ['ctrl', 'shift'] })).toEqual([
      'Ctrl',
      'Shift',
      'K',
    ])
    expect(shortcutLabelParts({ key: 'F2', modifiers: ['alt'] })).toEqual(['Alt', 'F2'])
  })
})

describe('menuShortcutLabel', () => {
  it('joins the parts with spaces and skips unassigned bindings', () => {
    expect(menuShortcutLabel({ key: 'Enter', modifiers: ['ctrl', 'alt'] })).toBe('Ctrl Alt Enter')
    expect(menuShortcutLabel(null)).toBeUndefined()
  })
})
