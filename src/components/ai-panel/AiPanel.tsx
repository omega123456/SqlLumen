import { useCallback, useState } from 'react'
import { useAiStore, extractTablesFromSql } from '../../stores/ai-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useAiFeedbackStore } from '../../stores/ai-feedback-store'
import { useAiMemoryStore } from '../../stores/ai-memory-store'
import { useConnectionStore } from '../../stores/connection-store'
import { AiPanelHeader } from './AiPanelHeader'
import { AiChatMessages } from './AiChatMessages'
import { AiChatInput } from './AiChatInput'
import { AiSetupRequired } from './AiSetupRequired'
import { InfoBar } from '../common/InfoBar'

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

function useIsMissingEmbeddingModel(): boolean {
  const aiEnabled = useSettingsStore(
    (state) =>
      (state.pendingChanges['ai.enabled'] ?? state.settings['ai.enabled'] ?? 'false') === 'true'
  )
  const embeddingModel = useSettingsStore(
    (state) =>
      state.pendingChanges['ai.embeddingModel'] ?? state.settings['ai.embeddingModel'] ?? ''
  )
  return aiEnabled && !embeddingModel
}

type AiPanelStatusBarsProps = Pick<AiPanelProps, 'tabId' | 'connectionId'>

function AiPanelStatusBars({ tabId, connectionId }: AiPanelStatusBarsProps) {
  const isWaitingForIndex = useAiStore((state) => state.tabs[tabId]?.isWaitingForIndex ?? false)
  const profileId = useConnectionStore(
    (state) =>
      (connectionId ? state.activeConnections[connectionId]?.profile?.id : undefined) ?? null
  )
  const reembedStatus = useAiMemoryStore((state) =>
    profileId ? state.reembedStatus[profileId] : undefined
  )
  const isReembedding = reembedStatus?.status === 'running'
  return (
    <>
      {isWaitingForIndex && (
        <InfoBar
          severity="info"
          className="mx-3.5 mt-2 shrink-0"
          message="Waiting for schema index..."
          data-testid="ai-index-waiting"
        />
      )}
      {isReembedding && reembedStatus && reembedStatus.total > 0 && (
        <InfoBar
          severity="info"
          className="mx-3.5 mt-2 shrink-0"
          message={`Re-embedding memories... ${reembedStatus.done}/${reembedStatus.total}`}
          data-testid="ai-memory-reembed-banner"
        />
      )}
    </>
  )
}

function useRecordAcceptedSql(connectionId: AiPanelProps['connectionId']) {
  return useCallback(
    (sql: string) => {
      if (!connectionId) return
      const tables = extractTablesFromSql(sql)
      if (tables.length > 0) {
        useAiFeedbackStore.getState().recordAccepted(connectionId, tables)
      }
    },
    [connectionId]
  )
}

export function AiPanel({ tabId, connectionId, onTriggerDiff }: AiPanelProps) {
  const [suggestionText, setSuggestionText] = useState<string | undefined>(undefined)
  const isMissingEmbeddingModel = useIsMissingEmbeddingModel()

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

  const handleSqlAccepted = useRecordAcceptedSql(connectionId)

  if (isMissingEmbeddingModel) {
    return (
      <div
        className="flex h-full flex-col overflow-hidden border-l border-light-stroke-divider bg-light-surface-container dark:border-dark-stroke-divider dark:bg-dark-surface-container"
        data-testid="ai-panel"
      >
        <AiPanelHeader tabId={tabId} />
        <AiSetupRequired />
        <AiChatInput
          tabId={tabId}
          connectionId={null}
          disabled
          placeholder="Embedding model required — configure in AI settings"
          workspaceTabId={tabId}
        />
      </div>
    )
  }

  return (
    <div
      className="flex h-full flex-col overflow-hidden border-l border-light-stroke-divider bg-light-surface-container dark:border-dark-stroke-divider dark:bg-dark-surface-container"
      data-testid="ai-panel"
    >
      <AiPanelHeader tabId={tabId} />
      <AiPanelStatusBars tabId={tabId} connectionId={connectionId} />
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
        workspaceTabId={tabId}
      />
    </div>
  )
}

export default AiPanel
