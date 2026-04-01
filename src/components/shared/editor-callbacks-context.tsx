/**
 * EditorCallbacksContext — provides real store callbacks to cell editors
 * when they are rendered inside BaseGridView (which uses NOOP callbacks).
 *
 * BaseGridView intentionally passes NOOP_EDITOR_CALLBACKS to its column
 * definitions so that column objects stay stable during editing (preventing
 * editor focus loss). Editors detect the NOOP callbacks (tabId === '') and
 * fall back to this context to obtain real store update functions.
 *
 * The wrapper component (e.g. TableDataGrid) provides the context value
 * by wrapping BaseGridView in an <EditorCallbacksContext.Provider>.
 *
 * IMPORTANT: The context's syncCellValue should typically be a no-op for
 * table data editing — calling the real syncCellValue during typing would
 * update the backing row array, triggering rows → autoColumnWidths →
 * rdgColumns recomputation, which creates new renderEditCell references
 * and causes editor focus loss.
 */

import { createContext, useContext } from 'react'

export interface EditorCallbacksContextType {
  tabId: string
  updateCellValue: (tabId: string, columnName: string, value: unknown) => void
  syncCellValue: (
    tabId: string,
    rowData: Record<string, unknown> | undefined,
    columnName: string,
    value: unknown
  ) => void
}

export const EditorCallbacksContext = createContext<EditorCallbacksContextType | null>(null)

/**
 * Read editor callbacks from the nearest context provider.
 * Returns null when no provider is present (e.g. standalone editor tests).
 */
export function useEditorCallbacks(): EditorCallbacksContextType | null {
  return useContext(EditorCallbacksContext)
}
