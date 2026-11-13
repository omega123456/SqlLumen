import type { AiState, TabAiState } from '../ai-store'
import { withoutKey } from '../../lib/record-utils'

type AiTabs = Pick<AiState, 'tabs'>

export interface AiTabEntry {
  tabId: string
  tab: TabAiState
}

export interface AiTabPatch {
  tabId: string
  partial: Partial<TabAiState>
  fallbackTab: TabAiState
}

export function putAiTab(state: AiTabs, { tabId, tab }: AiTabEntry): AiTabs {
  return { tabs: { ...state.tabs, [tabId]: tab } }
}

export function patchAiTab(state: AiTabs, { tabId, partial, fallbackTab }: AiTabPatch): AiTabs {
  const existing = state.tabs[tabId] ?? fallbackTab
  return putAiTab(state, { tabId: tabId, tab: { ...existing, ...partial } })
}

export function removeAiTab(state: AiTabs, tabId: string): AiTabs {
  return { tabs: withoutKey(state.tabs, tabId) }
}
