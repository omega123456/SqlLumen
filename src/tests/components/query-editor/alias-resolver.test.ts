import { describe, it, expect } from 'vitest'
import { EntityContextType } from 'monaco-sql-languages'
import {
  buildAliasMap,
  buildAliasMapFromText,
  stripQuotes,
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
// stripQuotes tests
// ---------------------------------------------------------------------------

describe('stripQuotes', () => {
  it('removes surrounding backticks', () => {
    expect(stripQuotes('`users`')).toBe('users')
  })

  it('removes surrounding double quotes', () => {
    expect(stripQuotes('"users"')).toBe('users')
  })

  it('removes surrounding single quotes', () => {
    expect(stripQuotes("'users'")).toBe('users')
  })

  it('returns the string unchanged if no surrounding quotes', () => {
    expect(stripQuotes('users')).toBe('users')
  })

  it('returns empty string unchanged', () => {
    expect(stripQuotes('')).toBe('')
  })

  it('returns single char unchanged', () => {
    expect(stripQuotes('a')).toBe('a')
  })

  it('does not strip mismatched quotes', () => {
    expect(stripQuotes('`users"')).toBe('`users"')
    expect(stripQuotes('"users`')).toBe('"users`')
  })

  it('strips to empty when quotes surround nothing', () => {
    expect(stripQuotes('``')).toBe('')
    expect(stripQuotes('""')).toBe('')
    expect(stripQuotes("''")).toBe('')
  })

  it('only strips the outermost quotes', () => {
    expect(stripQuotes('`"inner"`')).toBe('"inner"')
  })
})

// ---------------------------------------------------------------------------
// buildAliasMap tests
// ---------------------------------------------------------------------------

describe('buildAliasMap', () => {
  it('returns empty map when entities is null', () => {
    const map = buildAliasMap(null, 'ecommerce_db')
    expect(map.size).toBe(0)
  })

  it('returns empty map when entities is empty', () => {
    const map = buildAliasMap([], 'ecommerce_db')
    expect(map.size).toBe(0)
  })

  it('resolves qualified alias: db.table with alias', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entities = [makeEntity('db.table', 't', true)] as any[]
    const map = buildAliasMap(entities, 'ecommerce_db')
    expect(map.size).toBe(1)
    expect(map.get('t')).toEqual({ database: 'db', table: 'table' })
  })

  it('resolves unqualified alias with activeDatabase', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entities = [makeEntity('table', 't', true)] as any[]
    const map = buildAliasMap(entities, 'ecommerce_db')
    expect(map.size).toBe(1)
    expect(map.get('t')).toEqual({ database: 'ecommerce_db', table: 'table' })
  })

  it('skips unqualified alias when activeDatabase is null', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entities = [makeEntity('table', 't', true)] as any[]
    const map = buildAliasMap(entities, null)
    expect(map.size).toBe(0)
  })

  it('stores aliases as lowercase (case-insensitive)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entities = [makeEntity('db.table', 'T', true)] as any[]
    const map = buildAliasMap(entities, null)
    expect(map.has('t')).toBe(true)
    expect(map.has('T')).toBe(false)
  })

  it('handles multiple aliases in same entity list', () => {
    const entities = [
      makeEntity('users', 'u', true),
      makeEntity('orders', 'o', true),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any[]
    const map = buildAliasMap(entities, 'ecommerce_db')
    expect(map.size).toBe(2)
    expect(map.get('u')).toEqual({ database: 'ecommerce_db', table: 'users' })
    expect(map.get('o')).toEqual({ database: 'ecommerce_db', table: 'orders' })
  })

  it('handles backtick-quoted: `db`.`table`', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entities = [makeEntity('`db`.`table`', 't', true)] as any[]
    const map = buildAliasMap(entities, null)
    expect(map.size).toBe(1)
    expect(map.get('t')).toEqual({ database: 'db', table: 'table' })
  })

  it('handles double-quoted: "db"."table"', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entities = [makeEntity('"db"."table"', 't', true)] as any[]
    const map = buildAliasMap(entities, null)
    expect(map.size).toBe(1)
    expect(map.get('t')).toEqual({ database: 'db', table: 'table' })
  })

  it('handles backtick-quoted table only (no db): `table`', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entities = [makeEntity('`table`', 't', true)] as any[]
    const map = buildAliasMap(entities, 'ecommerce_db')
    expect(map.size).toBe(1)
    expect(map.get('t')).toEqual({ database: 'ecommerce_db', table: 'table' })
  })

  it('skips entities with null _alias', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entities = [makeEntity('users', null, true)] as any[]
    const map = buildAliasMap(entities, 'ecommerce_db')
    expect(map.size).toBe(0)
  })

  it('skips entities with undefined _alias', () => {
    const entity = makeEntity('users', null, true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (entity as any)._alias
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = buildAliasMap([entity] as any[], 'ecommerce_db')
    expect(map.size).toBe(0)
  })

  it('skips entities with empty text', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entities = [makeEntity('', 't', true)] as any[]
    const map = buildAliasMap(entities, 'ecommerce_db')
    expect(map.size).toBe(0)
  })

  it('prefers entities with belongStmt.isContainCaret when some have it', () => {
    const entities = [
      makeEntity('users', 'u', true), // in caret statement
      makeEntity('other_table', 'o', false), // NOT in caret statement
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any[]
    const map = buildAliasMap(entities, 'ecommerce_db')
    expect(map.size).toBe(1)
    expect(map.get('u')).toEqual({ database: 'ecommerce_db', table: 'users' })
    expect(map.has('o')).toBe(false)
  })

  it('falls back to all aliased entities when none have isContainCaret', () => {
    const entities = [
      makeEntity('users', 'u', false),
      makeEntity('orders', 'o', false),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any[]
    const map = buildAliasMap(entities, 'ecommerce_db')
    expect(map.size).toBe(2)
    expect(map.get('u')).toBeDefined()
    expect(map.get('o')).toBeDefined()
  })

  it('skips non-TABLE entity types', () => {
    // COLUMN entities should not produce alias map entries
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entities = [makeEntity('id', 'c', true, EntityContextType.COLUMN)] as any[]
    const map = buildAliasMap(entities, 'ecommerce_db')
    expect(map.size).toBe(0)
  })

  it('strips quotes from alias text too', () => {
    const entity = makeEntity('db.table', null, true)
    // Manually set alias with backtick-quoted text
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(entity as any)._alias = {
      text: '`t`',
      line: 1,
      startIndex: 0,
      endIndex: 3,
      startColumn: 1,
      endColumn: 4,
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = buildAliasMap([entity] as any[], null)
    expect(map.has('t')).toBe(true)
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

  it('extracts alias from basic FROM clause', () => {
    const map = buildAliasMapFromText('SELECT * FROM users t WHERE t.id = 1', 'ecommerce_db')
    expect(map.get('t')).toEqual({ database: 'ecommerce_db', table: 'users' })
  })

  it('extracts alias from cross-database FROM clause', () => {
    const map = buildAliasMapFromText(
      'SELECT * FROM analytics_db.events e WHERE e.id = 1',
      'ecommerce_db'
    )
    expect(map.get('e')).toEqual({ database: 'analytics_db', table: 'events' })
  })

  it('extracts alias with AS keyword', () => {
    const map = buildAliasMapFromText('SELECT * FROM users AS u WHERE u.id = 1', 'ecommerce_db')
    expect(map.get('u')).toEqual({ database: 'ecommerce_db', table: 'users' })
  })

  it('extracts alias from JOIN clause', () => {
    const map = buildAliasMapFromText(
      'SELECT * FROM users u JOIN orders o ON u.id = o.user_id',
      'ecommerce_db'
    )
    expect(map.get('u')).toEqual({ database: 'ecommerce_db', table: 'users' })
    expect(map.get('o')).toEqual({ database: 'ecommerce_db', table: 'orders' })
  })

  it('extracts alias from LEFT JOIN clause', () => {
    const map = buildAliasMapFromText(
      'SELECT * FROM users u LEFT JOIN orders o ON u.id = o.user_id',
      'ecommerce_db'
    )
    expect(map.get('o')).toEqual({ database: 'ecommerce_db', table: 'orders' })
  })

  it('stores aliases as lowercase', () => {
    const map = buildAliasMapFromText('SELECT * FROM users T WHERE T.id = 1', 'ecommerce_db')
    expect(map.has('t')).toBe(true)
    expect(map.has('T')).toBe(false)
  })

  it('skips SQL reserved words as aliases', () => {
    // "WHERE" follows "users" — should NOT be treated as an alias
    const map = buildAliasMapFromText('SELECT * FROM users WHERE id = 1', 'ecommerce_db')
    expect(map.has('where')).toBe(false)
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

  it('handles backtick-quoted table names', () => {
    const map = buildAliasMapFromText('SELECT * FROM `users` t WHERE t.id = 1', 'ecommerce_db')
    expect(map.get('t')).toEqual({ database: 'ecommerce_db', table: 'users' })
  })

  it('handles backtick-quoted db.table', () => {
    const map = buildAliasMapFromText(
      'SELECT * FROM `analytics_db`.`events` e WHERE e.id = 1',
      'ecommerce_db'
    )
    expect(map.get('e')).toEqual({ database: 'analytics_db', table: 'events' })
  })

  it('extracts multiple aliases from complex query', () => {
    const sql =
      'SELECT u.name, o.total FROM users u JOIN orders o ON u.id = o.user_id WHERE u.active = 1'
    const map = buildAliasMapFromText(sql, 'ecommerce_db')
    expect(map.get('u')).toEqual({ database: 'ecommerce_db', table: 'users' })
    expect(map.get('o')).toEqual({ database: 'ecommerce_db', table: 'orders' })
  })

  it('handles qualified table with activeDatabase fallback', () => {
    const map = buildAliasMapFromText('SELECT * FROM analytics_db.events e', 'ecommerce_db')
    // Should use the explicit database, not activeDatabase
    expect(map.get('e')).toEqual({ database: 'analytics_db', table: 'events' })
  })

  it('excludes aliases that appear after the caretOffset', () => {
    const sql = 'SELECT * FROM users u WHERE u.id = 1; SELECT * FROM orders o WHERE o.total > 100'
    // caretOffset points to somewhere in the first statement (after 'u.id')
    const caretOffset = sql.indexOf('; SELECT')
    const map = buildAliasMapFromText(sql, 'ecommerce_db', caretOffset)
    // 'u' should be found (before caret)
    expect(map.get('u')).toEqual({ database: 'ecommerce_db', table: 'users' })
    // 'o' should NOT be found (after caret)
    expect(map.has('o')).toBe(false)
  })

  it('includes aliases that appear before the caretOffset', () => {
    const sql = 'SELECT * FROM users u JOIN orders o ON u.id = o.user_id WHERE '
    // caretOffset at the end of the text
    const caretOffset = sql.length
    const map = buildAliasMapFromText(sql, 'ecommerce_db', caretOffset)
    expect(map.get('u')).toEqual({ database: 'ecommerce_db', table: 'users' })
    expect(map.get('o')).toEqual({ database: 'ecommerce_db', table: 'orders' })
  })

  it('scans all text when caretOffset is omitted', () => {
    const sql = 'SELECT * FROM users u WHERE u.id = 1; SELECT * FROM orders o WHERE o.total > 100'
    const map = buildAliasMapFromText(sql, 'ecommerce_db')
    // Both aliases should be found when no caretOffset is given
    expect(map.get('u')).toEqual({ database: 'ecommerce_db', table: 'users' })
    expect(map.get('o')).toEqual({ database: 'ecommerce_db', table: 'orders' })
  })

  it('handles caretOffset of 0 (empty effective text)', () => {
    const sql = 'SELECT * FROM users u WHERE u.id = 1'
    const map = buildAliasMapFromText(sql, 'ecommerce_db', 0)
    expect(map.size).toBe(0)
  })
})
