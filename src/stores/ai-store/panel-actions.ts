import { cancelAiStream } from '../../lib/ai-commands'
import { useQueryStore } from '../query-store'
import { logFrontend } from '../../lib/app-log-commands'
import { toErrorMessage } from '../../lib/error-message'
import { isAiLockStatus } from '../../lib/query-tab-status'
import { removeAiTab } from './ai-tab-reducers'
import type { AttachedContext } from '../ai-store'
import { callUnlistenSafely, ensureTab, patchTab, resetResponseChain } from './ai-store-access'
import { buildAttachedContextMessage } from './context-messages'
import { clearExpansionCache } from './expansion-cache'
import { activeRequestResetFragment, responseChainResetFragment } from './stream-actions'
import { removePromptOnlyContextMessages } from './turn-context'
import { useAiStore } from '../ai-store'

export function togglePanel(tabId: string): void {
  ensureTab(tabId)
  const tab = useAiStore.getState().tabs[tabId]
  patchTab(tabId, { isPanelOpen: !tab.isPanelOpen })
}

export function openPanel(tabId: string): void {
  ensureTab(tabId)
  patchTab(tabId, { isPanelOpen: true })
}

export function closePanel(tabId: string): void {
  ensureTab(tabId)
  patchTab(tabId, { isPanelOpen: false })
}

export function setAttachedContext(tabId: string, context: AttachedContext): void {
  ensureTab(tabId)
  patchTab(tabId, { attachedContext: context })

  const currentTab = useAiStore.getState().tabs[tabId]
  const currentAttachedMessage = currentTab?.messages.find(
    (message) => message.kind === 'attached-context'
  )

  const attachedSqlMessage = buildAttachedContextMessage(context.sql)
  if (currentAttachedMessage?.content !== attachedSqlMessage) {
    resetResponseChain(tabId)
  }

  removePromptOnlyContextMessages(tabId, ['attached-context'])
}

export function clearAttachedContext(tabId: string): void {
  ensureTab(tabId)
  patchTab(tabId, { attachedContext: null })
  removePromptOnlyContextMessages(tabId, ['attached-context'])
  resetResponseChain(tabId)
}

export function clearConversation(tabId: string): void {
  ensureTab(tabId)
  const tab = useAiStore.getState().tabs[tabId]
  const hadActiveStream = !!tab?.activeStreamId

  if (tab?._unlisten) {
    callUnlistenSafely(tabId, tab)
  }

  if (tab?.activeStreamId) {
    cancelAiStream(tab.activeStreamId).catch((error) => {
      const errorMessage = toErrorMessage(error)
      logFrontend('warn', `[ai-store] AI cancel during clearConversation failed: ${errorMessage}`)
    })
  }

  patchTab(tabId, {
    ...activeRequestResetFragment(),
    ...responseChainResetFragment(),
    messages: [],
    error: null,
    providedChunkKeys: {},
    cumulativeSchemaTokens: 0,
    providedMemoryIds: {},
  })

  if (hadActiveStream) {
    useAiStore.getState().restoreTabStatus(tabId)
  }
}

export function setError(tabId: string, error: string): void {
  ensureTab(tabId)
  patchTab(tabId, { error })
}

export function clearError(tabId: string): void {
  ensureTab(tabId)
  patchTab(tabId, { error: null })
}

export function setAiReviewing(tabId: string): void {
  useQueryStore.getState().setTabStatus(tabId, 'ai-reviewing')
}

export function restoreTabStatus(tabId: string): void {
  const queryTab = useQueryStore.getState().tabs[tabId]
  if (!queryTab) return

  const { tabStatus, prevTabStatus: previousTabStatus } = queryTab
  if (isAiLockStatus(tabStatus)) {
    useQueryStore.getState().setTabStatus(tabId, previousTabStatus)
  }
}

export function cleanupTab(tabId: string): void {
  const tab = useAiStore.getState().tabs[tabId]

  clearExpansionCache(tabId)

  if (tab?.activeStreamId) {
    cancelAiStream(tab.activeStreamId).catch((error) => {
      const errorMessage = toErrorMessage(error)
      logFrontend(
        'warn',
        `[ai-store] AI cancel during cleanup for tab ${tabId} failed: ${errorMessage}`
      )
    })
  }

  if (tab?._unlisten) {
    try {
      tab._unlisten()
    } catch (error) {
      logFrontend(
        'warn',
        `[ai-store] Error calling unlisten for tab ${tabId}: ${toErrorMessage(error)}`
      )
    }
  }

  useAiStore.setState((state) => removeAiTab(state, tabId))
}

export function aiPanelActions() {
  return {
    togglePanel,
    openPanel,
    closePanel,
    setAttachedContext,
    clearAttachedContext,
    clearConversation,
    setError,
    clearError,
    setAiReviewing,
    restoreTabStatus,
    cleanupTab,
  }
}
