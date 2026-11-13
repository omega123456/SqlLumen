import { describe, expect, it } from 'vitest'
import {
  buildInitialTableSelection,
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

  it('selects only the initial table when one is given', () => {
    const selection = buildInitialTableSelection({
      databases: [shopDatabase],
      initialDatabase: 'shop',
      initialTable: 'orders',
    })
    expect(selection).toEqual({ shop: new Set(['orders']) })
  })

  it('selects every table of the initial database otherwise', () => {
    const selection = buildInitialTableSelection({
      databases: [shopDatabase],
      initialDatabase: 'shop',
    })
    expect(selection).toEqual({ shop: new Set(['orders', 'customers']) })
  })
})

describe('toggleTableSelection', () => {
  it('adds an unselected table', () => {
    expect(toggleTableSelection({}, 'shop', 'orders')).toEqual({ shop: new Set(['orders']) })
  })

  it('removes a selected table and drops the empty database entry', () => {
    const selection = { shop: new Set(['orders']) }
    expect(toggleTableSelection(selection, 'shop', 'orders')).toEqual({})
    expect(selection).toEqual({ shop: new Set(['orders']) })
  })
})

describe('toggleDatabaseSelection', () => {
  it('selects every table of a partly selected database', () => {
    const selection = { shop: new Set(['orders']) }
    expect(toggleDatabaseSelection(selection, shopDatabase)).toEqual({
      shop: new Set(['orders', 'customers']),
    })
  })

  it('clears a fully selected database', () => {
    const selection = { shop: new Set(['orders', 'customers']) }
    expect(toggleDatabaseSelection(selection, shopDatabase)).toEqual({})
  })
})
