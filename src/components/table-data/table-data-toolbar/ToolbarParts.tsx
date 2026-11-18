import type { ReactNode } from 'react'
import { ArrowsClockwise, Stop } from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import type { ToolbarTabView } from './toolbar-model'
import { joinClassNames } from '../../../lib/class-names'

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

interface ToolbarBadgesProps {
  isView: boolean
  isConnectionReadOnly: boolean
  showNoKeyBadge: boolean
}

export function ToolbarBadges({
  isView,
  isConnectionReadOnly,
  showNoKeyBadge,
}: ToolbarBadgesProps) {
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

interface LoadControlButtonProps {
  view: Pick<ToolbarTabView, 'isLoading' | 'isRestoring' | 'isCancelling'>
  isBusy: boolean
  onCancelLoad: () => void
  onRefresh: () => void
}

export function LoadControlButton({
  view,
  isBusy,
  onCancelLoad,
  onRefresh,
}: LoadControlButtonProps) {
  const isCancellableLoad = view.isLoading && !view.isRestoring
  if (isCancellableLoad) {
    return (
      <Button
        variant="subtle"
        size="toolbar"
        className="shrink-0 disabled:opacity-60"
        onClick={onCancelLoad}
        disabled={view.isCancelling}
        title="Cancel the running query"
        data-testid="btn-cancel-load"
      >
        <Stop size={14} weight="fill" />
        <span>{view.isCancelling ? 'Cancelling...' : 'Cancel'}</span>
      </Button>
    )
  }
  return (
    <Button
      variant="subtle"
      size="toolbar"
      iconOnly
      className="shrink-0"
      onClick={onRefresh}
      disabled={isBusy}
      title="Refresh data"
      data-testid="btn-refresh"
    >
      <ArrowsClockwise size={16} weight="regular" />
    </Button>
  )
}
