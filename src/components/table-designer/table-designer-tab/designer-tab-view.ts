import {
  useTableDesignerStore,
  type TableDesignerTabState,
} from '../../../stores/table-designer-store'
import type { DesignerSubTab } from '../../../types/schema'

export const SUB_TAB_ORDER: readonly DesignerSubTab[] = [
  'columns',
  'indexes',
  'fks',
  'properties',
  'ddl',
]

export const SUB_TAB_LABELS: Record<DesignerSubTab, string> = {
  columns: 'Columns',
  indexes: 'Indexes',
  fks: 'Foreign keys',
  properties: 'Table properties',
  ddl: 'DDL preview',
}

export function clearPendingNavigationAction(tabId: string) {
  useTableDesignerStore.getState().clearNavigationAction(tabId)
}

export interface DesignerTabView {
  mode: TableDesignerTabState['mode']
  validationErrors: Record<string, string>
  pendingNavigationAction: TableDesignerTabState['pendingNavigationAction']
  isDirty: boolean
  isLoading: boolean
  isDdlLoading: boolean
  loadError: string | null
  selectedSubTab: DesignerSubTab
  ddl: string
  ddlWarnings: string[]
  tableName: string
  columnCount: number
}

const NO_VALIDATION_ERRORS: Record<string, string> = {}
const NO_DDL_WARNINGS: string[] = []

export function designerTabView(
  tabState: TableDesignerTabState | undefined,
  mode: TableDesignerTabState['mode']
): DesignerTabView {
  if (!tabState) {
    return {
      mode: mode,
      validationErrors: NO_VALIDATION_ERRORS,
      pendingNavigationAction: null,
      isDirty: false,
      isLoading: mode === 'alter',
      isDdlLoading: false,
      loadError: null,
      selectedSubTab: 'columns',
      ddl: '',
      ddlWarnings: NO_DDL_WARNINGS,
      tableName: '',
      columnCount: 0,
    }
  }
  return {
    mode: tabState.mode,
    validationErrors: tabState.validationErrors,
    pendingNavigationAction: tabState.pendingNavigationAction,
    isDirty: tabState.isDirty,
    isLoading: tabState.isLoading,
    isDdlLoading: tabState.isDdlLoading,
    loadError: tabState.loadError,
    selectedSubTab: tabState.selectedSubTab,
    ddl: tabState.ddl,
    ddlWarnings: tabState.ddlWarnings,
    tableName: tabState.currentSchema.tableName,
    columnCount: tabState.currentSchema.columns.length,
  }
}

export function isApplyDisabled(view: DesignerTabView): boolean {
  if (!view.isDirty) return true
  if (view.isDdlLoading) return true
  if (Object.keys(view.validationErrors).length > 0) return true
  return view.mode === 'create' && view.tableName.trim() === ''
}

export function pluralizeColumns(columnCount: number): string {
  return `${columnCount} ${columnCount === 1 ? 'column' : 'columns'}`
}
