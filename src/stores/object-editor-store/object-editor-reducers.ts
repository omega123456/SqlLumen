import type { ObjectEditorStore, ObjectEditorTabState } from '../object-editor-store'
import { withoutKey } from '../../lib/record-utils'

type ObjectEditorTabs = Pick<ObjectEditorStore, 'tabs'>
export type ObjectEditorTabMeta = Pick<
  ObjectEditorTabState,
  'connectionId' | 'database' | 'objectName' | 'objectType' | 'mode'
>

export interface ObjectEditorTabPatch {
  tabId: string
  partial: Partial<ObjectEditorTabState>
}

export interface ObjectEditorTabInit {
  tabId: string
  meta: ObjectEditorTabMeta
}

function withTab(
  state: ObjectEditorTabs,
  tabId: string,
  tab: ObjectEditorTabState
): ObjectEditorTabs {
  return { tabs: { ...state.tabs, [tabId]: tab } }
}

function createObjectEditorTab(meta: ObjectEditorTabMeta): ObjectEditorTabState {
  return {
    connectionId: meta.connectionId,
    database: meta.database,
    objectName: meta.objectName,
    objectType: meta.objectType,
    mode: meta.mode,
    content: '',
    originalContent: '',
    isLoading: false,
    isSaving: false,
    error: null,
    pendingNavigationAction: null,
    savedObjectName: null,
  }
}

export function patchObjectEditorTabState(
  state: ObjectEditorTabs,
  { tabId, partial }: ObjectEditorTabPatch
): ObjectEditorTabs {
  const existing = state.tabs[tabId]
  if (!existing) return state
  return withTab(state, tabId, { ...existing, ...partial })
}

export function initObjectEditorTab(
  state: ObjectEditorTabs,
  { tabId, meta }: ObjectEditorTabInit
): ObjectEditorTabs {
  if (state.tabs[tabId]) return state
  return withTab(state, tabId, createObjectEditorTab(meta))
}

export function removeObjectEditorTab(state: ObjectEditorTabs, tabId: string): ObjectEditorTabs {
  if (!state.tabs[tabId]) return state
  return { tabs: withoutKey(state.tabs, tabId) }
}
