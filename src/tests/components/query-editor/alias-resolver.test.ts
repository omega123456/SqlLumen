import { describe, it, expect } from 'vitest'
import { EntityContextType } from 'dt-sql-parser'
import {
  buildAliasMap,
  buildAliasMapFromText,
} from '../../../components/query-editor/alias-resolver'

// ---------------------------------------------------------------------------
// Helper to build mock entities for testing
// ---------------------------------------------------------------------------

function makeEntity(
  text: string,
  aliasText: string | null,
  isContainCaret = false,
  entityContextType: string = EntityContextType.TABLE
) {
  return {
    entityContextType,
    text,
    position: {
      startIndex: 0,
      endIndex: text.length,
      line: 1,
      startColumn: 1,
      endColumn: text.length + 1,
    },
    belongStmt: {
      stmtContextType: 'selectStmt',
      position: {
        startIndex: 0,
        endIndex: 100,
        startLine: 1,
        endLine: 1,
        startColumn: 1,
        endColumn: 100,
      },
      rootStmt: null,
      parentStmt: null,
      isContainCaret,
    },
    _comment: null,
    _alias: aliasText
      ? {
          text: aliasText,
          line: 1,
          startIndex: 0,
          endIndex: aliasText.length,
          startColumn: text.length + 2,
          endColumn: text.length + 2 + aliasText.length,
        }
      : null,
  }
}

// ---------------------------------------------------------------------------
// buildAliasMap tests
// ---------------------------------------------------------------------------

describe('buildAliasMap', () => {
  it('skips unqualified alias when activeDatabase is null', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entities = [makeEntity('table', 't', true)] as any[]
    const map = buildAliasMap(entities, null)
    expect(map.size).toBe(0)
  })

  it('skips entities with empty text', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entities = [makeEntity('', 't', true)] as any[]
    const map = buildAliasMap(entities, 'ecommerce_db')
    expect(map.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// buildAliasMapFromText tests (text-based fallback)
// ---------------------------------------------------------------------------

describe('buildAliasMapFromText', () => {
  it('returns empty map for empty text', () => {
    const map = buildAliasMapFromText('', 'ecommerce_db')
    expect(map.size).toBe(0)
  })

  it('skips ON keyword as alias', () => {
    const map = buildAliasMapFromText('SELECT * FROM users ON id = 1', 'ecommerce_db')
    expect(map.has('on')).toBe(false)
  })

  it('skips when activeDatabase is null for unqualified tables', () => {
    const map = buildAliasMapFromText('SELECT * FROM users t WHERE t.id = 1', null)
    expect(map.size).toBe(0)
  })
})
