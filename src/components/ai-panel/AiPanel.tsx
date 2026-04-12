import { useCallback, useEffect, useState } from 'react'
import { useAiStore } from '../../stores/ai-store'
import { AiPanelHeader } from './AiPanelHeader'
import { AiChatMessages } from './AiChatMessages'
import { AiChatInput } from './AiChatInput'
import styles from './AiPanel.module.css'

export interface AiPanelProps {
  tabId: string
  connectionId: string | null
  onTriggerDiff?: (
    sql: string,
    range: {
      startLineNumber: number
      endLineNumber: number
      startColumn: number
      endColumn: number
    }
  ) => void
}

export function AiPanel({ tabId, connectionId, onTriggerDiff }: AiPanelProps) {
  const [suggestionText, setSuggestionText] = useState<string | undefined>(undefined)

  // Pre-load schema context so token count is visible immediately
  useEffect(() => {
    if (connectionId) {
      useAiStore.getState().preloadSchemaContext(tabId, connectionId)
    }
  }, [tabId, connectionId])

  const handleTriggerDiff = onTriggerDiff
    ? (sql: string) => {
        const context = useAiStore.getState().tabs[tabId]?.attachedContext
        if (!context) return
        onTriggerDiff(sql, context.range)
      }
    : undefined

  const handleSuggestionFill = useCallback((text: string) => {
    setSuggestionText(text)
  }, [])

  const handleSuggestionConsumed = useCallback(() => {
    setSuggestionText(undefined)
  }, [])

  return (
    <div className={styles.panel} data-testid="ai-panel">
      <AiPanelHeader tabId={tabId} />
      <AiChatMessages
        tabId={tabId}
        connectionId={connectionId}
        onTriggerDiff={handleTriggerDiff}
        onSuggestionFill={handleSuggestionFill}
      />
      <AiChatInput
        tabId={tabId}
        connectionId={connectionId}
        suggestionText={suggestionText}
        onSuggestionConsumed={handleSuggestionConsumed}
      />
    </div>
  )
}
