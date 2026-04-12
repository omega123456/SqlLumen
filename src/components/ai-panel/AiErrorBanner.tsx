import { WarningCircle } from '@phosphor-icons/react'
import { Button } from '../common/Button'
import styles from './AiErrorBanner.module.css'

export interface AiErrorBannerProps {
  error: string
  onRetry?: () => void
}

export function AiErrorBanner({ error, onRetry }: AiErrorBannerProps) {
  return (
    <div className={styles.banner} role="alert" data-testid="ai-error-banner">
      <div className={styles.content}>
        <WarningCircle size={16} weight="fill" className={styles.icon} />
        <span className={styles.text}>{error}</span>
      </div>
      {onRetry && (
        <Button
          variant="ghost"
          className={styles.retryButton}
          onClick={onRetry}
          data-testid="ai-error-retry-button"
        >
          Retry
        </Button>
      )}
    </div>
  )
}
