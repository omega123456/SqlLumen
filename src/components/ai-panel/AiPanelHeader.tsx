import { Trash, X } from '@phosphor-icons/react'
import { useAiStore } from '../../stores/ai-store'
import { IconButton } from '../common/IconButton'
import { AiSchemaInfo } from './AiSchemaInfo'
import styles from './AiPanelHeader.module.css'

export interface AiPanelHeaderProps {
  tabId: string
}

export function AiPanelHeader({ tabId }: AiPanelHeaderProps) {
  return (
    <div className={styles.header} data-testid="ai-panel-header">
      <span className={styles.title}>AI Assistant</span>

      <div className={styles.schemaSlot}>
        <AiSchemaInfo tabId={tabId} />
      </div>

      <div className={styles.actions}>
        <IconButton
          className={styles.iconButton}
          onClick={() => useAiStore.getState().clearConversation(tabId)}
          title="Clear conversation"
          aria-label="Clear conversation"
          data-testid="ai-clear-button"
        >
          <Trash size={16} weight="regular" />
        </IconButton>
        <IconButton
          className={styles.iconButton}
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
