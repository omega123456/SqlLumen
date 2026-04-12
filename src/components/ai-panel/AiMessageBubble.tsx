import { MarkdownRenderer } from './markdown-renderer'
import type { AiMessage } from '../../stores/ai-store'
import styles from './AiMessageBubble.module.css'

export interface AiMessageBubbleProps {
  message: AiMessage
  isStreaming?: boolean
  onTriggerDiff?: (sql: string) => void
}

export function AiMessageBubble({ message, isStreaming, onTriggerDiff }: AiMessageBubbleProps) {
  if (message.role === 'system') {
    return (
      <div className={styles.systemMessage} data-testid="ai-message-system">
        Schema context loaded
      </div>
    )
  }

  if (message.role === 'user') {
    return (
      <div className={styles.userBubble} data-testid="ai-message-user">
        {message.content}
      </div>
    )
  }

  // assistant
  return (
    <div className={styles.assistantBubble} data-testid="ai-message-assistant">
      <div className={styles.markdownBody}>
        <MarkdownRenderer
          content={message.content}
          onTriggerDiff={onTriggerDiff}
          showDiffButton={!!onTriggerDiff}
        />
        {isStreaming && <span className={styles.streamingCursor} aria-hidden="true" />}
      </div>
    </div>
  )
}
