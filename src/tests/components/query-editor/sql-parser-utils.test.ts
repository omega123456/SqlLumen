import { describe, it, expect } from 'vitest'
import {
  splitStatements,
  findStatementAtCursor,
  cursorToOffset,
} from '../../../components/query-editor/sql-parser-utils'

describe('splitStatements', () => {
  it('ignores semicolons inside block comments', () => {
    const sql = 'SELECT 1 /* ; comment */ FROM t;'
    const stmts = splitStatements(sql)
    expect(stmts).toHaveLength(1)
  })

  it('handles escaped quotes in strings', () => {
    const sql = "SELECT 'it\\'s;here' FROM t;"
    const stmts = splitStatements(sql)
    expect(stmts).toHaveLength(1)
  })
})

describe('findStatementAtCursor', () => {
  it('finds statement containing cursor', () => {
    const sql = 'SELECT 1; SELECT 2;'
    const stmts = splitStatements(sql)
    const found = findStatementAtCursor(stmts, 5) // inside "SELECT 1"
    expect(found?.sql).toBe('SELECT 1')
  })

  it('returns last statement when cursor is at end', () => {
    const sql = 'SELECT 1; SELECT 2;'
    const stmts = splitStatements(sql)
    const found = findStatementAtCursor(stmts, 18)
    expect(found).not.toBeNull()
  })
})

describe('cursorToOffset', () => {
  it('converts line 1, col 1 to offset 0', () => {
    expect(cursorToOffset('SELECT 1', 1, 1)).toBe(0)
  })

  it('converts line 2, col 1 to correct offset', () => {
    const sql = 'SELECT 1\nFROM t'
    expect(cursorToOffset(sql, 2, 1)).toBe(9)
  })
})
