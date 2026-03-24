import { describe, it, expect } from 'vitest'
import {
  splitStatements,
  findStatementAtCursor,
  cursorToOffset,
} from '../../../components/query-editor/sql-parser-utils'

describe('splitStatements', () => {
  it('splits simple semicolon-delimited statements', () => {
    const sql = 'SELECT 1; SELECT 2;'
    const stmts = splitStatements(sql)
    expect(stmts).toHaveLength(2)
    expect(stmts[0].sql).toBe('SELECT 1')
    expect(stmts[1].sql).toBe('SELECT 2')
  })

  it('handles single statement without semicolon', () => {
    const stmts = splitStatements('SELECT * FROM users')
    expect(stmts).toHaveLength(1)
    expect(stmts[0].sql).toBe('SELECT * FROM users')
  })

  it('handles empty string', () => {
    expect(splitStatements('')).toHaveLength(0)
    expect(splitStatements('  ')).toHaveLength(0)
  })

  it('handles DELIMITER change', () => {
    const sql = 'DELIMITER $$\nSELECT 1$$\nDELIMITER ;'
    const stmts = splitStatements(sql)
    expect(stmts.some((s) => s.sql === 'SELECT 1')).toBe(true)
  })

  it('handles stored procedure with BEGIN END', () => {
    const sql = `DELIMITER $$
CREATE PROCEDURE test()
BEGIN
  SELECT 1;
  SELECT 2;
END$$
DELIMITER ;`
    const stmts = splitStatements(sql)
    expect(stmts.some((s) => s.sql.includes('CREATE PROCEDURE'))).toBe(true)
  })

  it('does not split inside string literals', () => {
    const sql = "SELECT 'hello;world' FROM t;"
    const stmts = splitStatements(sql)
    expect(stmts).toHaveLength(1)
    expect(stmts[0].sql).toContain("'hello;world'")
  })

  it('ignores semicolons inside line comments', () => {
    const sql = 'SELECT 1 -- ; this is not a split\nFROM t;'
    const stmts = splitStatements(sql)
    expect(stmts).toHaveLength(1)
  })

  it('ignores semicolons inside block comments', () => {
    const sql = 'SELECT 1 /* ; comment */ FROM t;'
    const stmts = splitStatements(sql)
    expect(stmts).toHaveLength(1)
  })

  it('ignores semicolons inside # comments', () => {
    const sql = 'SELECT 1 # ; hash comment\nFROM t;'
    const stmts = splitStatements(sql)
    expect(stmts).toHaveLength(1)
  })

  it('handles double-quoted strings', () => {
    const sql = 'SELECT "hello;world" FROM t;'
    const stmts = splitStatements(sql)
    expect(stmts).toHaveLength(1)
    expect(stmts[0].sql).toContain('"hello;world"')
  })

  it('handles backtick-quoted identifiers', () => {
    const sql = 'SELECT `col;name` FROM t;'
    const stmts = splitStatements(sql)
    expect(stmts).toHaveLength(1)
    expect(stmts[0].sql).toContain('`col;name`')
  })

  it('handles escaped quotes in strings', () => {
    const sql = "SELECT 'it\\'s;here' FROM t;"
    const stmts = splitStatements(sql)
    expect(stmts).toHaveLength(1)
  })

  it('does not treat DELIMITER inside a query as a directive', () => {
    const sql = 'SELECT delimiter FROM settings;'
    const stmts = splitStatements(sql)
    expect(stmts).toHaveLength(1)
    expect(stmts[0].sql).toBe('SELECT delimiter FROM settings')
  })

  it('only recognizes DELIMITER at start of a new line', () => {
    const sql = 'SELECT 1;\nDELIMITER $$\nSELECT 2$$\nDELIMITER ;'
    const stmts = splitStatements(sql)
    expect(stmts.some((s) => s.sql === 'SELECT 1')).toBe(true)
    expect(stmts.some((s) => s.sql === 'SELECT 2')).toBe(true)
  })

  it('handles multiple trailing whitespace', () => {
    const sql = 'SELECT 1;  \n  SELECT 2;  \n  '
    const stmts = splitStatements(sql)
    expect(stmts).toHaveLength(2)
    expect(stmts[0].sql).toBe('SELECT 1')
    expect(stmts[1].sql).toBe('SELECT 2')
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

  it('returns null for empty statements array', () => {
    expect(findStatementAtCursor([], 0)).toBeNull()
  })

  it('finds correct statement for multi-line SQL', () => {
    const sql = 'SELECT 1;\nSELECT 2;\nSELECT 3;'
    const stmts = splitStatements(sql)
    // Cursor at position 15 is in second statement area
    const found = findStatementAtCursor(stmts, 15)
    expect(found?.sql).toBe('SELECT 2')
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

  it('converts specific column', () => {
    expect(cursorToOffset('SELECT 1', 1, 8)).toBe(7)
  })

  it('handles multi-line with specific column', () => {
    const sql = 'SELECT 1\nFROM t\nWHERE id = 1'
    // Line 3, column 7 → offset should be past "SELECT 1\nFROM t\n" (16 chars) + 6
    expect(cursorToOffset(sql, 3, 7)).toBe(22)
  })
})
