import { Sparkle } from '@phosphor-icons/react'
import { useAiStore } from '../../stores/ai-store'
import { useQueryStore } from '../../stores/query-store'
import { IconButton } from '../common/IconButton'
import type { QueryEditorTab as QueryEditorTabType } from '../../types/schema'
import { isEditorLockStatus } from '../../lib/query-tab-status'

export interface QueryWorkspaceAiRailProps {
  tab: QueryEditorTabType
}

export function QueryWorkspaceAiRail({ tab }: QueryWorkspaceAiRailProps) {
  const openPanel = useAiStore((state) => state.openPanel)
  const status = useQueryStore((state) => state.tabs[tab.id]?.tabStatus ?? 'idle')
  const isDisabled = isEditorLockStatus(status)

  return (
    <div
      className="flex min-h-0 w-11 shrink-0 flex-col border-l border-light-stroke-divider bg-light-surface-container dark:border-dark-stroke-divider dark:bg-dark-surface-container"
      data-testid="ai-workspace-sidebar"
    >
      <div
        className="flex w-full flex-1 flex-col items-center pt-1.5"
        data-testid="ai-workspace-rail"
      >
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
