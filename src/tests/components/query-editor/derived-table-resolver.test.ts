import { describe, it, expect } from 'vitest'
import type { EntityContext } from 'monaco-sql-languages'
import { EntityContextType } from 'dt-sql-parser'
import { buildDerivedTableMap } from '../../../components/query-editor/derived-table-resolver'

const LITERAL_TABLE = 0
const TABLE_DECLARED_BY_EXPRESSION = 1

interface ColumnSpec {
  text: string
  alias?: string
}

interface DerivedTableSpec {
  text: string
  alias?: string
  columns: ColumnSpec[]
  sourceTables?: string[]
  isContainCaret?: boolean
  declareType?: number
}

function wordRange(text: string) {
  return { text: text, line: 1, startIndex: 0, endIndex: text.length, startColumn: 1, endColumn: 1 }
}

function belongStmt(isContainCaret: boolean) {
  return { stmtContextType: 'selectStmt', rootStmt: null, parentStmt: null, isContainCaret }
}

function columnEntity(column: ColumnSpec) {
  return {
    entityContextType: EntityContextType.COLUMN,
    text: column.text,
    _alias: column.alias ? wordRange(column.alias) : null,
  }
}

function tableEntity(text: string) {
  return { entityContextType: EntityContextType.TABLE, text, relatedEntities: null }
}

function derivedTableEntity(spec: DerivedTableSpec): EntityContext {
  const queryResult = {
    entityContextType: EntityContextType.QUERY_RESULT,
    text: spec.columns.map((column) => column.text).join(', '),
    columns: spec.columns.map(columnEntity),
    relatedEntities: (spec.sourceTables ?? []).map(tableEntity),
  }
  return {
    entityContextType: EntityContextType.TABLE,
    text: spec.text,
    declareType: spec.declareType ?? TABLE_DECLARED_BY_EXPRESSION,
    belongStmt: belongStmt(spec.isContainCaret ?? true),
    relatedEntities: [queryResult],
    _alias: spec.alias ? wordRange(spec.alias) : null,
  } as unknown as EntityContext
}

describe('buildDerivedTableMap', () => {
  it('returns an empty map without entities', () => {
    expect(buildDerivedTableMap(null, 'app_db').size).toBe(0)
    expect(buildDerivedTableMap([], 'app_db').size).toBe(0)
  })

  it('maps a CTE by its alias and its name to the CTE select-list columns', () => {
    const cte = derivedTableEntity({
      text: 'recent',
      alias: 'r',
      columns: [{ text: 'id' }, { text: 'total' }],
      sourceTables: ['orders'],
    })

    const map = buildDerivedTableMap([cte], 'app_db')

    const expected = { columnNames: ['id', 'total'], wildcardTables: [] }
    expect(map.get('r')).toEqual(expected)
    expect(map.get('recent')).toEqual(expected)
  })

  it('maps a derived table by its alias only, using column aliases and unqualified names', () => {
    const derived = derivedTableEntity({
      text: '(SELECT o.id, name AS full_name, COUNT(*) FROM orders o)',
      alias: '`D`',
      columns: [{ text: 'o.id' }, { text: 'name', alias: 'full_name' }, { text: 'COUNT(*)' }],
    })

    const map = buildDerivedTableMap([derived], 'app_db')

    expect([...map.keys()]).toEqual(['d'])
    expect(map.get('d')?.columnNames).toEqual(['id', 'full_name'])
  })

  it('strips quotes from backtick-quoted column names', () => {
    const derived = derivedTableEntity({
      text: 'recent',
      columns: [{ text: 'o.`order id`' }],
    })

    expect(buildDerivedTableMap([derived], null).get('recent')?.columnNames).toEqual(['order id'])
  })

  it('resolves the source tables of a wildcard select list', () => {
    const cte = derivedTableEntity({
      text: 'recent',
      alias: 'r',
      columns: [{ text: '*' }],
      sourceTables: ['orders', 'analytics_db.events'],
    })

    const derivedTable = buildDerivedTableMap([cte], 'app_db').get('r')

    expect(derivedTable?.columnNames).toEqual([])
    expect(derivedTable?.wildcardTables).toEqual([
      { database: 'app_db', table: 'orders' },
      { database: 'analytics_db', table: 'events' },
    ])
  })

  it('skips wildcard source tables that cannot be resolved without a database', () => {
    const cte = derivedTableEntity({
      text: 'recent',
      columns: [{ text: '*' }],
      sourceTables: ['orders'],
    })

    expect(buildDerivedTableMap([cte], null).get('recent')?.wildcardTables).toEqual([])
  })

  it('ignores literal tables and tables without a related query result', () => {
    const literal = derivedTableEntity({
      text: 'users',
      alias: 'u',
      columns: [{ text: 'id' }],
      declareType: LITERAL_TABLE,
    })
    const withoutQueryResult = {
      ...derivedTableEntity({ text: 'recent', columns: [] }),
      relatedEntities: [tableEntity('orders')],
    } as unknown as EntityContext

    expect(buildDerivedTableMap([literal, withoutQueryResult], 'app_db').size).toBe(0)
  })
})
