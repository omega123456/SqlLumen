import { joinClassNames } from '../../lib/class-names'

interface ConnectionStatusIndicatorProps {
  status: 'connected' | 'disconnected' | 'reconnecting'
  size?: number
}

const STATUS_CLASS_NAMES: Record<ConnectionStatusIndicatorProps['status'], string> = {
  connected: 'bg-light-tertiary dark:bg-dark-tertiary',
  disconnected: 'bg-light-error dark:bg-dark-error',
  reconnecting: 'bg-light-warning dark:bg-dark-warning',
}

export function ConnectionStatusIndicator({ status, size = 8 }: ConnectionStatusIndicatorProps) {
  return (
    <span
      className={joinClassNames([
        'inline-block shrink-0 rounded-round',
        STATUS_CLASS_NAMES[status],
      ])}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Status: ${status}`}
      data-testid="status-dot"
    />
  )
}
