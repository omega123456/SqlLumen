import {
  discardCurrentRow,
  insertDraftRow,
  startEditingRow,
  syncCellValue,
  updateCellValue,
} from '../data-view/edit-actions'
import { saveCurrentRow } from '../data-view/row-save'
import { deleteRows } from '../data-view/row-deletion'
import { cloneSelectedRow } from '../data-view/row-clone'
import { beginRowAction } from '../data-view/row-action-progress'
import {
  cancelNavigation,
  confirmNavigation,
  requestNavigationAction,
} from '../data-view/navigation-guard'
import { requestTabNavigation } from './query-surface'

export function queryDataViewActions() {
  return {
    startEditingRow: startEditingRow,
    cloneSelectedRow: cloneSelectedRow,
    insertDraftRow: insertDraftRow,
    updateCellValue: updateCellValue,
    syncCellValue: syncCellValue,
    saveCurrentRow: saveCurrentRow,
    discardCurrentRow: discardCurrentRow,
    deleteResultRows: deleteRows,
    beginRowAction: beginRowAction,
    requestNavigationAction: requestNavigationAction,
    requestTabNavigation: requestTabNavigation,
    confirmNavigation: confirmNavigation,
    cancelNavigation: cancelNavigation,
  }
}
