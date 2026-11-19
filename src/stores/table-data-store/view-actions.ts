import { updateView } from '../data-view/route-registry'
import {
  clearTableDataColumnHighlight,
  consumeTableDataColumnJump,
  requestTableDataColumnJump,
} from './table-data-reducers'
import { tableSurfaceRef } from './table-data-tab-state'
import { useTableDataStore } from '../table-data-store'

export function requestColumnJump(tabId: string, columnName: string): void {
  useTableDataStore.setState((state) =>
    requestTableDataColumnJump(state, { tabId: tabId, columnName: columnName })
  )
}

export function consumeColumnJump(tabId: string): void {
  useTableDataStore.setState((state) => consumeTableDataColumnJump(state, tabId))
}

export function clearColumnHighlight(tabId: string): void {
  useTableDataStore.setState((state) => clearTableDataColumnHighlight(state, tabId))
}

export function closeExportDialog(tabId: string): void {
  updateView(tableSurfaceRef(tabId), { prompts: { isExportOpen: false } })
}

export function viewActions() {
  return {
    requestColumnJump,
    consumeColumnJump,
    clearColumnHighlight,
    closeExportDialog,
  }
}
