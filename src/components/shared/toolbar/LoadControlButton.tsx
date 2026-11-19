import { ArrowsClockwise, Stop } from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import type { DataViewReload } from '../data-view/data-view-source'

interface LoadControlButtonProps {
  reload: DataViewReload
  isBusy: boolean
}

export function LoadControlButton({ reload, isBusy }: LoadControlButtonProps) {
  if (reload.isLoading) {
    return (
      <Button
        variant="subtle"
        size="toolbar"
        className="shrink-0 disabled:opacity-60"
        onClick={reload.onCancel}
        disabled={reload.isCancelling}
        title="Cancel the running query"
        data-testid="btn-cancel-load"
      >
        <Stop size={14} weight="fill" />
        <span>{reload.isCancelling ? 'Cancelling...' : 'Cancel'}</span>
      </Button>
    )
  }
  return (
    <Button
      variant="subtle"
      size="toolbar"
      iconOnly
      className="shrink-0"
      onClick={reload.onReload}
      disabled={isBusy}
      title="Refresh data"
      data-testid="btn-refresh"
    >
      <ArrowsClockwise size={16} weight="regular" />
    </Button>
  )
}
