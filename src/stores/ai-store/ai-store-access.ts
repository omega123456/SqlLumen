import { logFrontend } from '../../lib/app-log-commands'
import { patchAiTab, putAiTab } from './ai-tab-reducers'
import { createDefaultTabAiState, useAiStore } from '../ai-store'
import type { TabAiState } from '../ai-store'
import { clearExpansionCache } from './expansion-cache'
import { responseChainResetFragment } from './stream-actions'

export function ensureTab(tabId: string): TabAiState {
  const existing = useAiStore.getState().tabs[tabId]
  if (existing) return existing
  const fresh = createDefaultTabAiState()
  useAiStore.setState((state) => putAiTab(state, { tabId: tabId, tab: fresh }))
  clearExpansionCache(tabId)
  return fresh
}

export function tabForActiveStream(tabId: string, streamId: string): TabAiState | undefined {
  const tab = useAiStore.getState().tabs[tabId]
  if (tab?.activeStreamId !== streamId) return undefined
  return tab
}

export function patchTab(tabId: string, partial: Partial<TabAiState>) {
  const fallbackTab = createDefaultTabAiState()
  useAiStore.setState((state) =>
    patchAiTab(state, { tabId: tabId, partial: partial, fallbackTab: fallbackTab })
  )
}

export function callUnlistenSafely(tabId: string, tab: TabAiState | undefined): void {
  if (tab?._unlisten) {
    try {
      tab._unlisten()
    } catch (error) {
      logFrontend('warn', `[ai-store] Removing the stream listener failed: ${String(error)}`)
    }
    patchTab(tabId, { _unlisten: null })
  }
}

export function resetResponseChain(tabId: string): void {
  if (!useAiStore.getState().tabs[tabId]) return
  patchTab(tabId, responseChainResetFragment())
}

export function isActiveStream(tabId: string, streamId: string): boolean {
  const tab = useAiStore.getState().tabs[tabId]
  return tab?.activeStreamId === streamId && tab.isGenerating
}
