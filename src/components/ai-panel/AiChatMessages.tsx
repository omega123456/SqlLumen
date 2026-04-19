import { useRef, useEffect, useCallback, useState } from 'react'
import { useAiStore } from '../../stores/ai-store'
import { useSettingsStore } from '../../stores/settings-store'
import { AiMessageBubble } from './AiMessageBubble'
import { AiWelcomeState } from './AiWelcomeState'
import { AiErrorBanner } from './AiErrorBanner'
import type { AiMessage } from '../../stores/ai-store'
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

export function AiChatMessages({
  tabId,
  connectionId,
  onTriggerDiff,
  onSuggestionFill,
  onSqlAccepted,
}: AiChatMessagesProps) {
  const messages = useAiStore((s) => s.tabs[tabId]?.messages ?? EMPTY_MESSAGES)
  const error = useAiStore((s) => s.tabs[tabId]?.error ?? null)
  const isGenerating = useAiStore((s) => s.tabs[tabId]?.isGenerating ?? false)
  const scrollAnchorRef = useRef<HTMLDivElement>(null)
  const [internalSuggestion, setInternalSuggestion] = useState('')

  const hasAttachedContext = useAiStore((s) => s.tabs[tabId]?.attachedContext != null)

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    const el = scrollAnchorRef.current
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  const handleRetry = useCallback(() => {
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

  const handleSuggestionClick = useCallback(
    (text: string) => {
      if (onSuggestionFill) {
        onSuggestionFill(text)
      } else {
        setInternalSuggestion(text)
      }
    },
    [onSuggestionFill]
  )

  // Determine which is the last assistant message for streaming indicator
  const lastAssistantIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return i
    }
    return -1
  })()

  const showWelcome = messages.length === 0 && !error

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

      {messages.map((msg, idx) => {
        const isLastAssistant = idx === lastAssistantIdx
        const isStreamingMessage = isLastAssistant && isGenerating

        // Spacing: 16px between different senders, 8px between same sender
        const prevMsg = idx > 0 ? messages[idx - 1] : null
        const sameSender = prevMsg && prevMsg.role === msg.role
        const spacingClass = sameSender ? styles.sameSenderGap : styles.differentSenderGap

        return (
          <div key={msg.id} className={idx > 0 ? spacingClass : undefined}>
            <AiMessageBubble
              message={msg}
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
