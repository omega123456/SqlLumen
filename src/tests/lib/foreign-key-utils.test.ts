import { describe, expect, it } from 'vitest'
import { buildForeignKeyLookup, mapSingleColumnForeignKeys } from '../../lib/foreign-key-utils'
import type { ForeignKeyInfo, ForeignKeyColumnInfo } from '../../types/schema'

describe('mapSingleColumnForeignKeys', () => {
  it('returns an empty array for missing input', () => {
    expect(mapSingleColumnForeignKeys(undefined)).toEqual([])
    expect(mapSingleColumnForeignKeys(null)).toEqual([])
    expect(mapSingleColumnForeignKeys([])).toEqual([])
  })

  it('maps single-column foreign keys and drops multi-column constraints', () => {
    const foreignKeys: ForeignKeyInfo[] = [
      {
        name: 'fk_orders_customer',
        columnName: 'customer_id',
        referencedDatabase: 'crm',
        referencedTable: 'customers',
        referencedColumn: 'id',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      {
        name: 'fk_order_lines_composite',
        columnName: 'order_id',
        referencedDatabase: 'sales',
        referencedTable: 'orders',
        referencedColumn: 'id',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      {
        name: 'fk_order_lines_composite',
        columnName: 'line_id',
        referencedDatabase: 'sales',
        referencedTable: 'order_lines',
        referencedColumn: 'id',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
    ]

    expect(mapSingleColumnForeignKeys(foreignKeys)).toEqual<ForeignKeyColumnInfo[]>([
      {
        columnName: 'customer_id',
        referencedDatabase: 'crm',
        referencedTable: 'customers',
        referencedColumn: 'id',
        constraintName: 'fk_orders_customer',
      },
    ])
  })
})

describe('buildForeignKeyLookup', () => {
  it('returns an empty map for missing input', () => {
    expect(buildForeignKeyLookup(undefined)).toEqual(new Map())
    expect(buildForeignKeyLookup(null)).toEqual(new Map())
  })

  it('builds a case-insensitive lookup by lowercased column name', () => {
    const foreignKeys: ForeignKeyColumnInfo[] = [
      {
        columnName: 'Customer_ID',
        referencedDatabase: 'crm',
        referencedTable: 'customers',
        referencedColumn: 'id',
        constraintName: 'fk_orders_customer',
      },
    ]

    const lookup = buildForeignKeyLookup(foreignKeys)

    expect(lookup.size).toBe(1)
    expect(lookup.get('customer_id')).toEqual(foreignKeys[0])
    expect(lookup.has('Customer_ID')).toBe(false)
  })
})
