import { describe, expect, it } from 'vitest'
import { EditorMySQLParser } from '../../workers/editor-mysql-parser'
import { classifySqlIdentifiers } from '../../workers/sql-identifier-classifier'
import type { SqlIdentifierKind, SqlStatementIdentifiers } from '../../workers/sql-identifier-types'

interface IdentifierWord {
  kind: SqlIdentifierKind
  text: string
}

function classify(sql: string): SqlStatementIdentifiers[] {
  return classifySqlIdentifiers(new EditorMySQLParser(), sql)
}

function wordsOf(sql: string, statement: SqlStatementIdentifiers): IdentifierWord[] {
  const lines = sql.split('\n')
  const sorted = [...statement.identifiers].sort(
    (left, right) =>
      left.range.lineNumber - right.range.lineNumber ||
      left.range.startColumn - right.range.startColumn
  )
  return sorted.map((span) => {
    const line = lines[span.range.lineNumber - 1]
    const start = span.range.startColumn - 1
    return { kind: span.kind, text: line.slice(start, start + span.range.length) }
  })
}

function onlyStatement(sql: string): SqlStatementIdentifiers {
  const statements = classify(sql)
  expect(statements).toHaveLength(1)
  return statements[0]
}

describe('classifySqlIdentifiers', () => {
  it('unquotes backtick names but keeps the quotes inside the range', () => {
    const sql = 'SELECT `t`.`col` FROM `shop`.`t`'
    const statement = onlyStatement(sql)

    expect(statement.qualifiedColumns[0]).toEqual({
      qualifier: { database: null, table: 't' },
      column: { name: 'col', range: { lineNumber: 1, startColumn: 12, length: 5 } },
    })
    expect(statement.tables[0].database?.name).toBe('shop')
    expect(wordsOf(sql, statement).map((word) => word.text)).toEqual([
      '`t`',
      '`col`',
      '`shop`',
      '`t`',
    ])
  })

  it('records the alias of UPDATE and DELETE targets', () => {
    const [update, deletion] = classify(
      'UPDATE users u SET u.name = 1 WHERE id = 2; DELETE FROM orders o WHERE o.id = 1'
    )

    expect(update.tables[0]).toMatchObject({ alias: 'u' })
    expect(update.qualifiedColumns[0].qualifier.table).toBe('u')
    expect(deletion.tables[0]).toMatchObject({ alias: 'o' })
    expect(deletion.qualifiedColumns[0].qualifier.table).toBe('o')
  })

  it('treats a multi-table DELETE target that names an alias as that alias', () => {
    const sql = 'DELETE f FROM foo AS f'
    const statement = onlyStatement(sql)

    expect(statement.tables.map((table) => table.table.name)).toEqual(['foo'])
    expect(wordsOf(sql, statement)[0]).toEqual({ kind: 'tableAlias', text: 'f' })
  })

  it('does not require tables dropped with IF EXISTS to exist', () => {
    const [dropTable, dropView, plainDrop] = classify(
      'DROP TABLE IF EXISTS a, b; DROP VIEW IF EXISTS v; DROP TABLE c'
    )

    expect(dropTable.tables).toEqual([])
    expect(dropTable.identifiers).toHaveLength(2)
    expect(dropView.tables).toEqual([])
    expect(plainDrop.tables.map((table) => table.table.name)).toEqual(['c'])
  })

  it('records created views and renamed tables as created', () => {
    const [view, rename] = classify('CREATE VIEW v AS SELECT 1; RENAME TABLE a TO b')

    expect(view.createdTables).toEqual(['v'])
    expect(rename.createdTables).toEqual(['b'])
    expect(rename.tables.map((table) => table.table.name)).toEqual(['a'])
  })

  it('classifies database names outside USE without changing the used database', () => {
    const sql = 'CREATE DATABASE archive; SHOW TABLES FROM shop'
    const [create, show] = classify(sql)

    expect(wordsOf(sql, create)).toEqual([{ kind: 'database', text: 'archive' }])
    expect(create.usedDatabase).toBeNull()
    expect(wordsOf(sql, show)).toEqual([{ kind: 'database', text: 'shop' }])
  })

  it.each([
    'USE shop',
    'DROP TABLE IF EXISTS shop.a, b',
    'DROP VIEW v',
    'UPDATE shop.users AS u SET u.name = 1 WHERE u.id = 2',
    'DELETE FROM orders AS o WHERE o.id = 1',
    'WITH r (x) AS (SELECT 1) SELECT r.x, t.*, CONCAT(a) AS c FROM r, (SELECT 1) AS d, shop.t',
    'CREATE TABLE shop.notes (id INT)',
    'CREATE FUNCTION shop.f() RETURNS INT RETURN 1',
    'CALL shop.refresh(1)',
  ])('classifies every word-by-word prefix of %s without throwing', (sql) => {
    const words = sql.split(' ')
    const prefixes = words.map((_, wordIndex) => words.slice(0, wordIndex + 1).join(' '))

    for (const prefix of prefixes) {
      expect(() => classify(prefix)).not.toThrow()
    }
  })

  it('colours views named outside FROM, created functions and a dangling select qualifier', () => {
    const sql = 'SHOW CREATE VIEW v; CREATE FUNCTION shop.f() RETURNS INT RETURN 1; SELECT u.'
    const [showView, createFunction, select] = classify(sql)

    expect(wordsOf(sql, showView)).toEqual([{ kind: 'table', text: 'v' }])
    expect(showView.tables.map((table) => table.table.name)).toEqual(['v'])
    expect(wordsOf(sql, createFunction)).toEqual([
      { kind: 'database', text: 'shop' },
      { kind: 'function', text: 'f' },
    ])
    expect(wordsOf(sql, select)).toEqual([{ kind: 'table', text: 'u' }])
  })
})
