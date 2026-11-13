import type {
  TableDesignerStore,
  TableDesignerTabState,
  TableDesignerTarget,
} from '../table-designer-store'
import { computeIsDirty, createDefaultTabState, resetSchemaFor } from './designer-schema'
import type { SchemaEdit } from './schema-edits'
import { withoutKey } from '../../lib/record-utils'

type DesignerTabsState = Pick<TableDesignerStore, 'tabs'>

export interface DesignerTabPatch {
  tabId: string
  partial: Partial<TableDesignerTabState>
}

export interface DesignerTabInit {
  tabId: string
  target: TableDesignerTarget
}

export interface DesignerSchemaEdit {
  tabId: string
  edit: SchemaEdit
}

function withTab(
  state: DesignerTabsState,
  tabId: string,
  tab: TableDesignerTabState
): DesignerTabsState {
  return { tabs: { ...state.tabs, [tabId]: tab } }
}

function withRecomputedDirty(tab: TableDesignerTabState): TableDesignerTabState {
  return { ...tab, isDirty: computeIsDirty(tab) }
}

export function patchDesignerTab(
  state: DesignerTabsState,
  { tabId, partial }: DesignerTabPatch
): DesignerTabsState {
  const existing = state.tabs[tabId]
  if (!existing) return state
  return withTab(state, tabId, { ...existing, ...partial })
}

export function initDesignerTab(
  state: DesignerTabsState,
  { tabId, target }: DesignerTabInit
): DesignerTabsState {
  if (state.tabs[tabId]) return state
  return withTab(state, tabId, createDefaultTabState(target))
}

export function applyDesignerSchemaEdit(
  state: DesignerTabsState,
  { tabId, edit }: DesignerSchemaEdit
): DesignerTabsState {
  const existing = state.tabs[tabId]
  if (!existing) return state
  const editedTab = withRecomputedDirty({
    ...existing,
    currentSchema: edit.schema,
    validationErrors: edit.validationErrors ?? existing.validationErrors,
  })
  return withTab(state, tabId, editedTab)
}

export function discardDesignerChanges(state: DesignerTabsState, tabId: string): DesignerTabsState {
  const existing = state.tabs[tabId]
  if (!existing) return state
  const resetTab = withRecomputedDirty({
    ...existing,
    currentSchema: resetSchemaFor(existing),
    validationErrors: {},
    ddl: '',
    ddlError: null,
    ddlWarnings: [],
    isDdlLoading: true,
  })
  return withTab(state, tabId, resetTab)
}

export function removeDesignerTab(state: DesignerTabsState, tabId: string): DesignerTabsState {
  if (!state.tabs[tabId]) return state
  return { tabs: withoutKey(state.tabs, tabId) }
}
