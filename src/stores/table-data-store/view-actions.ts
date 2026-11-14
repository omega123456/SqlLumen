import type { SelectedCellInfo } from '../../types/schema'
import {
  clearTableDataColumnHighlight,
  consumeTableDataColumnJump,
  requestTableDataColumnJump,
} from './table-data-reducers'
import { patchTab } from './table-data-access'
import { useTableDataStore } from '../table-data-store'

export function setViewMode(tabId: string, mode: 'grid' | 'form'): void {
  patchTab(tabId, { viewMode: mode })
}

export function setSelectedRow(tabId: string, rowKey: Record<string, unknown> | null): void {
  patchTab(tabId, { selectedRowKey: rowKey })
}

export function setCheckedRowKeys(tabId: string, rowKeys: Record<string, unknown>[]): void {
  patchTab(tabId, { checkedRowKeys: rowKeys })
}

export function setSelectedCell(tabId: string, cell: SelectedCellInfo | null): void {
  patchTab(tabId, { selectedCell: cell })
}

export function requestColumnJump(tabId: string, columnKey: string): void {
  useTableDataStore.setState((state) =>
    requestTableDataColumnJump(state, { tabId: tabId, columnKey: columnKey })
  )
}

export function consumeColumnJump(tabId: string): void {
  useTableDataStore.setState((state) => consumeTableDataColumnJump(state, tabId))
}

export function clearColumnHighlight(tabId: string): void {
  useTableDataStore.setState((state) => clearTableDataColumnHighlight(state, tabId))
}

export function setColumnWidth(tabId: string, column: string, width: number): void {
  const tab = useTableDataStore.getState().tabs[tabId]
  if (!tab) return
  if (!Number.isFinite(width)) return
  patchTab(tabId, { columnWidths: { ...(tab.columnWidths ?? {}), [column]: width } })
}

export function openExportDialog(tabId: string): void {
  patchTab(tabId, { isExportDialogOpen: true })
}

export function closeExportDialog(tabId: string): void {
  patchTab(tabId, { isExportDialogOpen: false })
}

export function setScrollCell(tabId: string, scrollRow: number, scrollColumn: number): void {
  patchTab(tabId, { scrollRow: scrollRow, scrollCol: scrollColumn })
}

export function viewActions() {
  return {
    setViewMode,
    setSelectedRow,
    setCheckedRowKeys,
    setSelectedCell,
    requestColumnJump,
    consumeColumnJump,
    clearColumnHighlight,
    setColumnWidth,
    openExportDialog,
    closeExportDialog,
    setScrollCell,
  }
}
