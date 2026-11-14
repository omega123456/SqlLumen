import { createContext, useCallback, useContext } from 'react'

export interface CellValueSync {
  rowData: Record<string, unknown> | undefined
  column: string
  value: unknown
}

export type UpdateCellValue = (tabId: string, column: string, value: unknown) => void
export type SyncCellValue = (tabId: string, sync: CellValueSync) => void

export interface EditorCallbacksContextType {
  tabId: string
  updateCellValue: UpdateCellValue
  syncCellValue: SyncCellValue
}

export const EditorCallbacksContext = createContext<EditorCallbacksContextType | null>(null)

export function useEditorCallbacks(): EditorCallbacksContextType | null {
  return useContext(EditorCallbacksContext)
}

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
      if (!tabId) return
      if (!fieldName) return
      if (!updateCellValue) return
      updateCellValue(tabId, fieldName, nextValue)
      syncCellValue?.(tabId, { rowData: row, column: fieldName, value: nextValue })
    },
    [fieldName, tabId, updateCellValue, syncCellValue, row]
  )
}
