import { Button } from '../common/Button'
import { InfoBar } from '../common/InfoBar'
import styles from './AiErrorBanner.module.css'

export interface AiErrorBannerProps {
  error: string
  onRetry?: () => void
}

export function AiErrorBanner({ error, onRetry }: AiErrorBannerProps) {
  return (
    <InfoBar
      severity="error"
      className={styles.banner}
      message={error}
      data-testid="ai-error-banner"
      actions={
        onRetry ? (
          <Button size="sm" onClick={onRetry} data-testid="ai-error-retry-button">
            Retry
          </Button>
        ) : undefined
      }
    />
  )
}
