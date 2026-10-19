import { Sparkle, Trash, X } from '@phosphor-icons/react'
import { useAiStore } from '../../stores/ai-store'
import { IconButton } from '../common/IconButton'
import styles from './AiPanelHeader.module.css'

export interface AiPanelHeaderProps {
  tabId: string
}

export function AiPanelHeader({ tabId }: AiPanelHeaderProps) {
  return (
    <div className={styles.header} data-testid="ai-panel-header">
      <Sparkle size={16} weight="regular" className={styles.sparkle} aria-hidden />
      <span className={styles.title}>AI assistant</span>

      <div className={styles.actions}>
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
