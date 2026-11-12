import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useFkLookupFlow } from '../../../components/table-data/use-fk-lookup-flow'

const FOREIGN_KEY = {
  columnName: 'user_id',
  referencedDatabase: 'shop',
  referencedTable: 'users',
  referencedColumn: 'id',
  constraintName: 'fk_orders_user',
}

describe('useFkLookupFlow', () => {
  it('opens a lookup target from the lookup request and closes it again', () => {
    const { result } = renderHook(() => useFkLookupFlow())
    expect(result.current.foreignKeyLookupTarget).toBeNull()

    act(() =>
      result.current.openForeignKeyLookup({
        columnKey: 'user_id',
        currentValue: 7,
        foreignKey: FOREIGN_KEY,
        rowData: { id: 1, user_id: 7 },
        source: 'keyboard',
      })
    )

    expect(result.current.foreignKeyLookupTarget).toEqual({
      columnKey: 'user_id',
      currentValue: 7,
      foreignKey: FOREIGN_KEY,
      rowData: { id: 1, user_id: 7 },
    })

    act(() => result.current.closeForeignKeyLookup())

    expect(result.current.foreignKeyLookupTarget).toBeNull()
  })
})
