import { useCallback, useState } from 'react'
import type { FkLookupArgs } from '../shared/fk-lookup-context'
import type { ForeignKeyColumnInfo } from '../../types/schema'

export interface ForeignKeyLookupTarget {
  columnKey: string
  currentValue: unknown
  foreignKey: ForeignKeyColumnInfo
  rowData: Record<string, unknown>
}

export interface FkLookupFlow {
  foreignKeyLookupTarget: ForeignKeyLookupTarget | null
  openForeignKeyLookup: (args: FkLookupArgs) => void
  closeForeignKeyLookup: () => void
}

export function useFkLookupFlow(): FkLookupFlow {
  const [foreignKeyLookupTarget, setForeignKeyLookupTarget] =
    useState<ForeignKeyLookupTarget | null>(null)

  const openForeignKeyLookup = useCallback((args: FkLookupArgs) => {
    setForeignKeyLookupTarget({
      columnKey: args.columnKey,
      currentValue: args.currentValue,
      foreignKey: args.foreignKey,
      rowData: args.rowData,
    })
  }, [])

  const closeForeignKeyLookup = useCallback(() => setForeignKeyLookupTarget(null), [])

  return {
    foreignKeyLookupTarget: foreignKeyLookupTarget,
    openForeignKeyLookup: openForeignKeyLookup,
    closeForeignKeyLookup: closeForeignKeyLookup,
  }
}
