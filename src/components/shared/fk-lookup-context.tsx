/**
 * FkLookupContext — provides FK lookup callback to cell renderers
 * when they are rendered inside BaseGridView.
 *
 * The wrapper component (e.g. TableDataGrid) provides the context value
 * by wrapping BaseGridView in a <FkLookupProvider>.
 *
 * Follows the same pattern as EditorCallbacksContext.
 */

import { createContext, useContext } from 'react'
import type { ForeignKeyColumnInfo } from '../../types/schema'

export interface FkLookupArgs {
  columnKey: string
  currentValue: unknown
  foreignKey: ForeignKeyColumnInfo
  rowData: Record<string, unknown>
}

export interface FkLookupContextValue {
  onFkLookup: (args: FkLookupArgs) => void
}

export const FkLookupContext = createContext<FkLookupContextValue | null>(null)

/**
 * Provider component for FK lookup context.
 * Wraps children with the FkLookupContext provider.
 */
export function FkLookupProvider({
  onFkLookup,
  children,
}: {
  onFkLookup: FkLookupContextValue['onFkLookup']
  children: React.ReactNode
}) {
  return <FkLookupContext.Provider value={{ onFkLookup }}>{children}</FkLookupContext.Provider>
}

/**
 * Read FK lookup callback from the nearest context provider.
 * Returns null when no provider is present (e.g. standalone tests).
 */
export function useFkLookup(): FkLookupContextValue | null {
  return useContext(FkLookupContext)
}
