import type { ReactNode } from 'react'
import { joinClassNames } from '../../lib/class-names'

type ToolbarBadgeKind = 'view' | 'readOnly' | 'noKey'

const BADGE_KIND_CLASSES: Record<ToolbarBadgeKind, string> = {
  view: 'select-none border border-light-primary-a30 bg-light-fill-accent-tint text-light-primary dark:border-dark-primary-a30 dark:bg-dark-fill-accent-tint dark:text-dark-primary',
  readOnly:
    'bg-light-fill-neutral-selected text-light-on-surface-variant dark:bg-dark-fill-neutral-selected dark:text-dark-on-surface-variant',
  noKey:
    'bg-light-warning-container text-light-warning dark:bg-dark-warning-container dark:text-dark-warning',
}

interface ToolbarBadgeProps {
  kind: ToolbarBadgeKind
  testId: string
  children: ReactNode
}

function ToolbarBadge({ kind, testId, children }: ToolbarBadgeProps) {
  return (
    <span
      className={joinClassNames([
        'flex h-5 shrink-0 items-center gap-0.75 rounded-control px-1.5 font-mono text-size-caption font-semibold whitespace-nowrap',
        BADGE_KIND_CLASSES[kind],
      ])}
      data-testid={testId}
    >
      {children}
    </span>
  )
}

interface TableDataBadgesProps {
  isView: boolean
  isConnectionReadOnly: boolean
  showNoKeyBadge: boolean
}

export function TableDataBadges({
  isView,
  isConnectionReadOnly,
  showNoKeyBadge,
}: TableDataBadgesProps) {
  return (
    <>
      {isView && (
        <ToolbarBadge kind="view" testId="view-badge">
          VIEW
        </ToolbarBadge>
      )}

      {isConnectionReadOnly && (
        <ToolbarBadge kind="readOnly" testId="readonly-badge">
          &#x1F512; READ-ONLY
        </ToolbarBadge>
      )}

      {showNoKeyBadge && (
        <ToolbarBadge kind="noKey" testId="nopk-badge">
          NO KEY
        </ToolbarBadge>
      )}
    </>
  )
}
