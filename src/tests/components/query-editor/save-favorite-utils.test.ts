import { describe, it, expect } from 'vitest'
import {
  resolveFavoriteSql,
  buildFavoriteDraft,
} from '../../../components/query-editor/save-favorite-utils'

describe('resolveFavoriteSql', () => {
  it('returns the trimmed selection when a selection exists', () => {
    const full = 'SELECT 1;\nSELECT 2;'
    expect(resolveFavoriteSql(full, '  SELECT 2;  ', { lineNumber: 1, column: 1 })).toBe('SELECT 2;')
  })

  it('falls back to the statement under the cursor when nothing is selected', () => {
    const full = 'SELECT 1;\nSELECT 2;'
    // Cursor on the second line → second statement (splitter drops the trailing ;).
    expect(resolveFavoriteSql(full, '', { lineNumber: 2, column: 3 })).toBe('SELECT 2')
  })

  it('falls back to the whole document when there is no cursor', () => {
    const full = 'SELECT 1;'
    expect(resolveFavoriteSql(full, '', null)).toBe('SELECT 1;')
  })

  it('falls back to the whole document when no statement is found at the cursor', () => {
    const full = '   '
    expect(resolveFavoriteSql(full, '', { lineNumber: 1, column: 1 })).toBe('')
  })

  it('ignores whitespace-only selections', () => {
    const full = 'SELECT 1;'
    expect(resolveFavoriteSql(full, '   \n  ', { lineNumber: 1, column: 1 })).toBe('SELECT 1')
  })
})

describe('buildFavoriteDraft', () => {
  it('builds a blank create-mode entry with the given SQL and connection', () => {
    const draft = buildFavoriteDraft('SELECT 1', 'conn-1')
    expect(draft).toEqual({
      id: 0,
      name: '',
      sqlText: 'SELECT 1',
      description: null,
      category: null,
      connectionId: 'conn-1',
      createdAt: '',
      updatedAt: '',
    })
  })

  it('accepts a null connection id for global scope', () => {
    expect(buildFavoriteDraft('SELECT 1', null).connectionId).toBeNull()
  })
})
