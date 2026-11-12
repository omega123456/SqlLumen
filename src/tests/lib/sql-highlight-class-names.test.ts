import { describe, expect, it } from 'vitest'
import { SQL_HIGHLIGHT_CLASS_NAMES } from '../../lib/sql-highlight-class-names'

describe('SQL_HIGHLIGHT_CLASS_NAMES', () => {
  it('maps every SQL token kind to a highlight class', () => {
    expect(Object.keys(SQL_HIGHLIGHT_CLASS_NAMES).sort()).toEqual([
      'identifier',
      'keyword',
      'number',
      'string',
      'type',
    ])
    for (const className of Object.values(SQL_HIGHLIGHT_CLASS_NAMES)) {
      expect(className).toEqual(expect.any(String))
    }
  })
})
