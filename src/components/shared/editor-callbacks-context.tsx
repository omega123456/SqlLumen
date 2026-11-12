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
 * column recomputation, which creates new editor references and causes editor
 * focus loss.
 */

import { createContext, useCallback, useContext } from 'react'

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

type UpdateCellValue = EditorCallbacksContextType['updateCellValue']
type SyncCellValue = EditorCallbacksContextType['syncCellValue']

export interface CellStoreSyncSource {
  row: Record<string, unknown>
  column: { key: string }
  tabId?: string
  updateCellValue?: UpdateCellValue
  syncCellValue?: SyncCellValue
}

interface EditorStoreCallbacks {
  tabId: string
  updateCellValue: UpdateCellValue | undefined
  syncCellValue: SyncCellValue | undefined
}

function resolveEditorStoreCallbacks(
  source: CellStoreSyncSource,
  contextCallbacks: EditorCallbacksContextType | null
): EditorStoreCallbacks {
  const tabId = source.tabId || contextCallbacks?.tabId || ''
  if (source.tabId) {
    return {
      tabId: tabId,
      updateCellValue: source.updateCellValue,
      syncCellValue: source.syncCellValue,
    }
  }
  return {
    tabId: tabId,
    updateCellValue: contextCallbacks?.updateCellValue ?? source.updateCellValue,
    syncCellValue: contextCallbacks?.syncCellValue ?? source.syncCellValue,
  }
}

export function useCellStoreSync(source: CellStoreSyncSource): (nextValue: unknown) => void {
  const contextCallbacks = useEditorCallbacks()
  const { tabId, updateCellValue, syncCellValue } = resolveEditorStoreCallbacks(
    source,
    contextCallbacks
  )
  const { row } = source
  const fieldName = source.column.key
  return useCallback(
    (nextValue: unknown) => {
      if (!tabId || !fieldName || !updateCellValue) return
      updateCellValue(tabId, fieldName, nextValue)
      syncCellValue?.(tabId, row, fieldName, nextValue)
    },
    [fieldName, tabId, updateCellValue, syncCellValue, row]
  )
}
