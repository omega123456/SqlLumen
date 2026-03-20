import styles from './ConnectionStatusIndicator.module.css'

interface ConnectionStatusIndicatorProps {
  status: 'connected' | 'disconnected' | 'reconnecting'
  size?: number
}

const statusClassMap: Record<ConnectionStatusIndicatorProps['status'], string> = {
  connected: styles.connected,
  disconnected: styles.disconnected,
  reconnecting: styles.reconnecting,
}

export function ConnectionStatusIndicator({ status, size = 8 }: ConnectionStatusIndicatorProps) {
  return (
    <span
      className={`${styles.dot} ${statusClassMap[status]}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Status: ${status}`}
      data-testid="status-dot"
    />
  )
}
