import { MarkdownRenderer } from './markdown-renderer'
import { StreamingCursor } from './StreamingCursor'
import { ThinkingBlock } from './ThinkingBlock'
import type { AiMessage } from '../../stores/ai-store'

export interface AiMessageBubbleProps {
  message: AiMessage
  isStreaming?: boolean
  onTriggerDiff?: (sql: string) => void
  onSqlAccepted?: (sql: string) => void
}

export function AiMessageBubble({
  message,
  isStreaming,
  onTriggerDiff,
  onSqlAccepted,
}: AiMessageBubbleProps) {
  if (message.role === 'system') {
    return (
      <div
        className="text-center text-size-caption leading-5 text-light-outline select-none dark:text-dark-outline"
        data-testid="ai-message-system"
      >
        Schema context loaded
      </div>
    )
  }

  if (message.role === 'user') {
    return (
      <div
        className="max-w-17/20 self-end rounded-t-overlay rounded-bl-overlay rounded-br-track bg-light-fill-accent-tint px-3 py-2 text-body wrap-break-word text-light-on-surface dark:bg-dark-fill-accent-tint dark:text-dark-on-surface"
        data-testid="ai-message-user"
      >
        {message.content}
      </div>
    )
  }

  return (
    <div
      className="max-w-full self-stretch text-body wrap-break-word text-light-on-surface dark:text-dark-on-surface"
      data-testid="ai-message-assistant"
    >
      {message.thinkingContent && (
        <ThinkingBlock content={message.thinkingContent} isStreaming={isStreaming} />
      )}
      <div>
        <MarkdownRenderer
          content={message.content}
          onTriggerDiff={onTriggerDiff}
          showDiffButton={!!onTriggerDiff}
          onSqlAccepted={onSqlAccepted}
        />
        {isStreaming && <StreamingCursor />}
      </div>
    </div>
  )
}
