import { Sparkle } from '@phosphor-icons/react'
import { useAiStore } from '../../stores/ai-store'
import { useQueryStore } from '../../stores/query-store'
import { IconButton } from '../common/IconButton'
import type { QueryEditorTab as QueryEditorTabType } from '../../types/schema'
import styles from './QueryWorkspaceAiRail.module.css'
import { isEditorLockStatus } from '../../lib/query-tab-status'

export interface QueryWorkspaceAiRailProps {
  tab: QueryEditorTabType
}

export function QueryWorkspaceAiRail({ tab }: QueryWorkspaceAiRailProps) {
  const openPanel = useAiStore((state) => state.openPanel)
  const status = useQueryStore((state) => state.tabs[tab.id]?.tabStatus ?? 'idle')
  const isDisabled = isEditorLockStatus(status)

  return (
    <div className={styles.railHost} data-testid="ai-workspace-sidebar">
      <div className={styles.rail} data-testid="ai-workspace-rail">
        <IconButton
          size="lg"
          title="Open AI assistant"
          aria-label="Open AI assistant"
          disabled={isDisabled}
          data-testid="ai-sidebar-expand"
          onClick={() => {
            openPanel(tab.id)
          }}
        >
          <Sparkle size={16} weight="regular" />
        </IconButton>
      </div>
    </div>
  )
}
