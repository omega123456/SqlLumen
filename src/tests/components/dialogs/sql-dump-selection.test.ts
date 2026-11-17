import { describe, expect, it } from 'vitest'
import {
  buildDumpTables,
  buildInitialTableSelection,
  selectedObjectCount,
  toggleDatabaseSelection,
  toggleTableSelection,
} from '../../../components/dialogs/sql-dump-selection'
import type { ExportableDatabase } from '../../../lib/sql-dump-commands'

const shopDatabase: ExportableDatabase = {
  name: 'shop',
  tables: [
    { name: 'orders', objectType: 'table', estimatedRows: 10 },
    { name: 'customers', objectType: 'table', estimatedRows: 5 },
  ],
}

describe('buildInitialTableSelection', () => {
  it('selects nothing without an initial database', () => {
    expect(buildInitialTableSelection({ databases: [shopDatabase] })).toEqual({})
  })

  it('selects nothing when the initial database is unknown', () => {
    const selection = buildInitialTableSelection({
      databases: [shopDatabase],
      initialDatabase: 'missing',
    })
    expect(selection).toEqual({})
  })
})

describe('toggleTableSelection', () => {
  it('adds an unselected table', () => {
    expect(toggleTableSelection({}, 'shop', 'orders')).toEqual({ shop: new Set(['orders']) })
  })
})

describe('toggleDatabaseSelection', () => {
  it('selects every table of a partly selected database', () => {
    const selection = { shop: new Set(['orders']) }
    expect(toggleDatabaseSelection(selection, shopDatabase)).toEqual({
      shop: new Set(['orders', 'customers']),
    })
  })
})

describe('buildDumpTables', () => {
  it('collects selected objects with their types and skips empty selections', () => {
    const result = buildDumpTables({ shop: new Set(['orders']), empty: new Set<string>() }, [
      shopDatabase,
    ])
    expect(result).toEqual({
      ok: true,
      databases: ['shop'],
      tables: { shop: [{ name: 'orders', objectType: 'table' }] },
    })
  })
})

describe('selectedObjectCount', () => {
  it('sums the selected objects across databases', () => {
    expect(
      selectedObjectCount({ shop: new Set(['orders', 'customers']), other: new Set(['x']) })
    ).toBe(3)
  })
})
