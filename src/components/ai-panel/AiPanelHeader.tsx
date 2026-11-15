import { Sparkle, Trash, X } from '@phosphor-icons/react'
import { useAiStore } from '../../stores/ai-store'
import { IconButton } from '../common/IconButton'

export interface AiPanelHeaderProps {
  tabId: string
}

export function AiPanelHeader({ tabId }: AiPanelHeaderProps) {
  return (
    <div
      className="flex h-command-bar shrink-0 items-center gap-2 border-b border-light-stroke-divider bg-light-surface-container pr-1.5 pl-3.5 dark:border-dark-stroke-divider dark:bg-dark-surface-container"
      data-testid="ai-panel-header"
    >
      <Sparkle
        size={16}
        weight="regular"
        className="shrink-0 text-light-primary dark:text-dark-primary"
        aria-hidden
      />
      <span className="flex-1 truncate font-body text-body font-semibold text-light-on-surface dark:text-dark-on-surface">
        AI assistant
      </span>

      <div className="flex shrink-0 items-center gap-2">
        <IconButton
          onClick={() => useAiStore.getState().clearConversation(tabId)}
          title="Clear conversation"
          aria-label="Clear conversation"
          data-testid="ai-clear-button"
        >
          <Trash size={16} weight="regular" />
        </IconButton>
        <IconButton
          onClick={() => useAiStore.getState().closePanel(tabId)}
          title="Close AI panel"
          aria-label="Close AI panel"
          data-testid="ai-close-button"
        >
          <X size={16} weight="regular" />
        </IconButton>
      </div>
    </div>
  )
}
