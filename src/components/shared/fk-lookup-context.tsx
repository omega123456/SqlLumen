import { createContext, useContext } from 'react'
import type { ForeignKeyColumnInfo } from '../../types/schema'

export interface FkLookupArgs {
  columnKey: string
  currentValue: unknown
  foreignKey: ForeignKeyColumnInfo
  rowData: Record<string, unknown>
  source?: 'grid-pointer' | 'keyboard' | 'keyboard-typing' | 'editor-trigger'
}

export interface FkLookupContextValue {
  onFkLookup: (args: FkLookupArgs) => void
}

export const FkLookupContext = createContext<FkLookupContextValue | null>(null)

export function FkLookupProvider({
  onFkLookup,
  children,
}: {
  onFkLookup: FkLookupContextValue['onFkLookup']
  children: React.ReactNode
}) {
  return <FkLookupContext.Provider value={{ onFkLookup }}>{children}</FkLookupContext.Provider>
}

export function useFkLookup(): FkLookupContextValue | null {
  return useContext(FkLookupContext)
}
