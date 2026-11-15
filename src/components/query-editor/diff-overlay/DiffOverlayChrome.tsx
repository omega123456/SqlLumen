import type { ReactNode } from 'react'
import { Button } from '../../common/Button'
import { joinClassNames } from '../../../lib/class-names'

type DiffOverlayBarPlacement = 'header' | 'footer'

const BAR_PLACEMENT_CLASSES: Record<DiffOverlayBarPlacement, string> = {
  header:
    'justify-between border-b border-b-light-stroke-divider dark:border-b-dark-stroke-divider',
  footer: 'justify-end border-t border-t-light-stroke-divider dark:border-t-dark-stroke-divider',
}

interface DiffOverlayBarProps {
  placement: DiffOverlayBarPlacement
  children: ReactNode
}

function DiffOverlayBar({ placement, children }: DiffOverlayBarProps) {
  return (
    <div
      className={joinClassNames([
        'flex h-command-bar shrink-0 items-center bg-light-surface-container-high px-4 dark:bg-dark-surface-container-high',
        BAR_PLACEMENT_CLASSES[placement],
      ])}
    >
      {children}
    </div>
  )
}

function DiffOverlayActions({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-2">{children}</div>
}

interface DiffOverlayHeaderProps {
  onReject: () => void
  onAcceptAll: () => void
}

export function DiffOverlayHeader({ onReject, onAcceptAll }: DiffOverlayHeaderProps) {
  return (
    <DiffOverlayBar placement="header">
      <span className="font-headline text-size-caption font-semibold text-light-on-surface dark:text-dark-on-surface">
        Review changes
      </span>
      <DiffOverlayActions>
        <Button variant="danger" size="sm" onClick={onReject} data-testid="diff-reject-button">
          Reject all
        </Button>
        <Button
          variant="accent"
          size="sm"
          onClick={onAcceptAll}
          data-testid="diff-accept-all-button"
        >
          Accept all
        </Button>
      </DiffOverlayActions>
    </DiffOverlayBar>
  )
}

interface DiffOverlayFooterProps {
  hunksAccepted: boolean
  onClose: () => void
}

export function DiffOverlayFooter({ hunksAccepted, onClose }: DiffOverlayFooterProps) {
  const closeLabel = hunksAccepted
    ? 'Apply accepted changes and close review'
    : 'Close review without updating the query'
  return (
    <DiffOverlayBar placement="footer">
      <DiffOverlayActions>
        <Button
          size="sm"
          onClick={onClose}
          title={closeLabel}
          aria-label={closeLabel}
          data-testid="diff-close-button"
        >
          Close
        </Button>
      </DiffOverlayActions>
    </DiffOverlayBar>
  )
}
