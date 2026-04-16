import { Sparkle } from '@phosphor-icons/react'
import { useAiStore } from '../../stores/ai-store'
import { useQueryStore } from '../../stores/query-store'
import { IconButton } from '../common/IconButton'
import type { QueryEditorTab as QueryEditorTabType } from '../../types/schema'
import styles from './QueryWorkspaceAiRail.module.css'

export interface QueryWorkspaceAiRailProps {
  tab: QueryEditorTabType
}

/** Fixed icon column on the right; opens the resizable AI chat panel. */
export function QueryWorkspaceAiRail({ tab }: QueryWorkspaceAiRailProps) {
  const openPanel = useAiStore((s) => s.openPanel)
  const status = useQueryStore((s) => s.tabs[tab.id]?.tabStatus ?? 'idle')
  const isDisabled = status === 'running' || status === 'ai-pending' || status === 'ai-reviewing'

  return (
    <div className={styles.railHost} data-testid="ai-workspace-sidebar">
      <div className={styles.rail} data-testid="ai-workspace-rail">
        <IconButton
          size="sm"
          title="Open AI Assistant"
          aria-label="Open AI Assistant"
          disabled={isDisabled}
          data-testid="ai-sidebar-expand"
          onClick={() => {
            openPanel(tab.id)
          }}
        >
          <Sparkle size={18} weight="regular" />
        </IconButton>
      </div>
    </div>
  )
}
