import { useCallback, useState } from 'react'
import { useAiStore, extractTablesFromSql } from '../../stores/ai-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useAiFeedbackStore } from '../../stores/ai-feedback-store'
import { AiPanelHeader } from './AiPanelHeader'
import { AiChatMessages } from './AiChatMessages'
import { AiChatInput } from './AiChatInput'
import { AiSetupRequired } from './AiSetupRequired'
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
  const isWaitingForIndex = useAiStore((s) => s.tabs[tabId]?.isWaitingForIndex ?? false)

  const aiEnabled = useSettingsStore(
    (s) => (s.pendingChanges['ai.enabled'] ?? s.settings['ai.enabled'] ?? 'false') === 'true'
  )
  const embeddingModel = useSettingsStore(
    (s) => s.pendingChanges['ai.embeddingModel'] ?? s.settings['ai.embeddingModel'] ?? ''
  )

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

  const handleSqlAccepted = useCallback(
    (sql: string) => {
      if (!connectionId) return
      const tables = extractTablesFromSql(sql)
      if (tables.length > 0) {
        useAiFeedbackStore.getState().recordAccepted(connectionId, tables)
      }
    },
    [connectionId]
  )

  if (aiEnabled && !embeddingModel) {
    return (
      <div className={styles.panel} data-testid="ai-panel">
        <AiPanelHeader tabId={tabId} />
        <AiSetupRequired />
        <AiChatInput
          tabId={tabId}
          connectionId={null}
          disabled
          placeholder="Embedding model required — configure in AI Settings"
        />
      </div>
    )
  }

  return (
    <div className={styles.panel} data-testid="ai-panel">
      <AiPanelHeader tabId={tabId} />
      {isWaitingForIndex && (
        <div className={styles.indexWaiting} data-testid="ai-index-waiting">
          Waiting for schema index...
        </div>
      )}
      <AiChatMessages
        tabId={tabId}
        connectionId={connectionId}
        onTriggerDiff={handleTriggerDiff}
        onSuggestionFill={handleSuggestionFill}
        onSqlAccepted={handleSqlAccepted}
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
