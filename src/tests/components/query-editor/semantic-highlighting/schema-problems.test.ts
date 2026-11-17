import { describe, expect, it } from 'vitest'
import type { SchemaCache } from '../../../../components/query-editor/schema-metadata-cache'
import { findSchemaProblems } from '../../../../components/query-editor/semantic-highlighting/schema-problems'
import { EditorMySQLParser } from '../../../../workers/editor-mysql-parser'
import { classifySqlIdentifiers } from '../../../../workers/sql-identifier-classifier'

function readyCache(): SchemaCache {
  return {
    status: 'ready',
    databases: ['shop', 'analytics', 'empty_db'],
    tables: {
      shop: [
        { name: 'users', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 1, dataSize: 1 },
        { name: 'orders', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 1, dataSize: 1 },
      ],
      analytics: [
        { name: 'Events', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 1, dataSize: 1 },
      ],
    },
    views: { shop: [{ name: 'active_users' }] },
    columns: {
      'shop.users': [
        { name: 'id', dataType: 'BIGINT' },
        { name: 'email', dataType: 'VARCHAR' },
      ],
      'shop.active_users': [{ name: 'id', dataType: 'BIGINT' }],
      'analytics.Events': [{ name: 'event_name', dataType: 'VARCHAR' }],
    },
    routines: {},
    triggers: {},
    foreignKeys: {},
    indexes: {},
  }
}

function problemsFor(sql: string, defaultDatabase: string | null = 'shop') {
  const statements = classifySqlIdentifiers(new EditorMySQLParser(), sql)
  return findSchemaProblems(statements, { cache: readyCache(), defaultDatabase: defaultDatabase })
}

function messagesFor(sql: string, defaultDatabase: string | null = 'shop'): string[] {
  return problemsFor(sql, defaultDatabase).map((problem) => problem.message)
}

describe('findSchemaProblems', () => {
  it('reports nothing for known tables, views and columns', () => {
    expect(
      messagesFor(
        'SELECT u.id, u.email, v.id, e.event_name FROM users u, active_users v, analytics.events e'
      )
    ).toEqual([])
  })

  it('reports an unknown database qualifier on its range', () => {
    expect(problemsFor('SELECT * FROM shopp.users')).toEqual([
      {
        message: 'Unknown database `shopp`',
        range: { lineNumber: 1, startColumn: 15, length: 5 },
      },
    ])
  })

  it('does not report system databases the schema cache leaves out', () => {
    expect(messagesFor('SELECT * FROM information_schema.TABLES, mysql.user')).toEqual([])
  })

  it('never reports CTE names, derived tables or tables the script creates', () => {
    expect(
      messagesFor(
        'WITH recent AS (SELECT 1) SELECT r.x, d.y FROM recent r, (SELECT 1 AS y) d; CREATE TABLE draft (id INT); INSERT INTO draft VALUES (1)'
      )
    ).toEqual([])
  })

  it('reports unknown columns qualified by table name or by database and table', () => {
    expect(messagesFor('SELECT users.nope, shop.users.gone FROM users')).toEqual([
      'Unknown column `nope` in `users`',
      'Unknown column `gone` in `users`',
    ])
  })

  it('never reports a column whose table has no resolvable database', () => {
    expect(messagesFor('SELECT u.nope FROM users u', null)).toEqual([])
  })

  it('never reports unqualified columns or unresolved qualifiers', () => {
    expect(messagesFor('SELECT nope, x.nope FROM users')).toEqual([])
  })

  it('never reports columns of CTEs, derived tables or tables without loaded columns', () => {
    expect(
      messagesFor(
        'WITH recent AS (SELECT 1) SELECT r.nope, recent.nope, d.nope, o.nope FROM recent r, (SELECT 1) d, orders o'
      )
    ).toEqual([])
  })
})
