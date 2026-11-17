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
})
