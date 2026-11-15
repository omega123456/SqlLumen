import { Button } from '../common/Button'
import { InfoBar } from '../common/InfoBar'

export interface AiErrorBannerProps {
  error: string
  onRetry?: () => void
}

export function AiErrorBanner({ error, onRetry }: AiErrorBannerProps) {
  return (
    <InfoBar
      severity="error"
      className="mx-3.5 my-2 shrink-0"
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
