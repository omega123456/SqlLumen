import { useRef, useEffect, useCallback, useState } from 'react'
import { useAiStore } from '../../stores/ai-store'
import { useSettingsStore } from '../../stores/settings-store'
import { AiMessageBubble } from './AiMessageBubble'
import { AiWelcomeState } from './AiWelcomeState'
import { AiErrorBanner } from './AiErrorBanner'
import type { AiMessage, TabAiState } from '../../stores/ai-store'
import styles from './AiChatMessages.module.css'

export interface AiChatMessagesProps {
  tabId: string
  connectionId?: string | null
  onTriggerDiff?: (sql: string) => void
  onSuggestionFill?: (text: string) => void
  onSqlAccepted?: (sql: string) => void
}

/** Stable empty array to avoid re-render loops when tab state doesn't exist. */
const EMPTY_MESSAGES: AiMessage[] = []
const HIDDEN_PROMPT_ONLY_KINDS = new Set<NonNullable<AiMessage['kind']>>([
  'schema-context',
  'memory-context',
  'attached-context',
])

function hasAttachedContextIn(tab: TabAiState | undefined): boolean {
  return tab?.attachedContext != null
}

function lastAssistantIndexOf(visibleMessages: AiMessage[]): number {
  for (let index = visibleMessages.length - 1; index >= 0; index--) {
    const message = visibleMessages[index]
    if (message.role === 'assistant') return index
  }
  return -1
}

function useScrollAnchor(visibleMessages: AiMessage[]) {
  const scrollAnchorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = scrollAnchorRef.current
    if (typeof element?.scrollIntoView === 'function') {
      element.scrollIntoView({ behavior: 'smooth' })
    }
  }, [visibleMessages])

  return scrollAnchorRef
}

function useRetryLastMessage(tabId: string, connectionId: string | null | undefined) {
  return useCallback(() => {
    if (!connectionId) return
    const settings = useSettingsStore.getState()
    const temperature = parseFloat(
      settings.pendingChanges['ai.temperature'] ?? settings.settings['ai.temperature'] ?? '0.3'
    )
    const maxTokens = parseInt(
      settings.pendingChanges['ai.maxTokens'] ?? settings.settings['ai.maxTokens'] ?? '2048',
      10
    )
    const model = settings.pendingChanges['ai.model'] ?? settings.settings['ai.model'] ?? ''
    useAiStore.getState().retryLastMessage(tabId, connectionId, { temperature, maxTokens, model })
  }, [tabId, connectionId])
}

function useSuggestionFill(onSuggestionFill: AiChatMessagesProps['onSuggestionFill']) {
  const [internalSuggestion, setInternalSuggestion] = useState('')

  const handleSuggestionClick = useCallback(
    (text: string) => {
      if (onSuggestionFill) {
        onSuggestionFill(text)
        return
      }
      setInternalSuggestion(text)
    },
    [onSuggestionFill]
  )

  return { internalSuggestion, handleSuggestionClick }
}

export function AiChatMessages({
  tabId,
  connectionId,
  onTriggerDiff,
  onSuggestionFill,
  onSqlAccepted,
}: AiChatMessagesProps) {
  const messages = useAiStore((state) => state.tabs[tabId]?.messages ?? EMPTY_MESSAGES)
  const error = useAiStore((state) => state.tabs[tabId]?.error ?? null)
  const isGenerating = useAiStore((state) => state.tabs[tabId]?.isGenerating ?? false)

  const hasAttachedContext = useAiStore((state) => hasAttachedContextIn(state.tabs[tabId]))
  const visibleMessages = messages.filter(
    (message) => !(message.kind && HIDDEN_PROMPT_ONLY_KINDS.has(message.kind))
  )

  const scrollAnchorRef = useScrollAnchor(visibleMessages)
  const handleRetry = useRetryLastMessage(tabId, connectionId)

  const { internalSuggestion, handleSuggestionClick } = useSuggestionFill(onSuggestionFill)
  const lastAssistantIndex = lastAssistantIndexOf(visibleMessages)

  const showWelcome = visibleMessages.length === 0 && !error

  return (
    <div
      className={styles.container}
      role="log"
      aria-live="polite"
      aria-busy={isGenerating}
      data-testid="ai-chat-messages"
    >
      {showWelcome && <AiWelcomeState onSuggestionClick={handleSuggestionClick} />}

      {error && <AiErrorBanner error={error} onRetry={connectionId ? handleRetry : undefined} />}

      {visibleMessages.map((message, index) => {
        const isLastAssistant = index === lastAssistantIndex
        const isStreamingMessage = isLastAssistant && isGenerating

        return (
          <div key={message.id} className={styles.message}>
            <AiMessageBubble
              message={message}
              isStreaming={isStreamingMessage}
              onTriggerDiff={hasAttachedContext ? onTriggerDiff : undefined}
              onSqlAccepted={onSqlAccepted}
            />
          </div>
        )
      })}

      <div ref={scrollAnchorRef} className={styles.scrollAnchor} />

      {/* Hidden element for suggestion fill synchronization in tests */}
      {internalSuggestion && (
        <span data-testid="ai-internal-suggestion" className={styles.hidden}>
          {internalSuggestion}
        </span>
      )}
    </div>
  )
}
