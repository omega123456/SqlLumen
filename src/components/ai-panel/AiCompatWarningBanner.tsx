import { Warning } from '@phosphor-icons/react'
import { Button } from '../common/Button'
import styles from './AiCompatWarningBanner.module.css'

export interface AiCompatWarningBannerProps {
  onDismiss: () => void
}

export function AiCompatWarningBanner({ onDismiss }: AiCompatWarningBannerProps) {
  return (
    <div className={styles.banner} role="status" data-testid="ai-compat-warning-banner">
      <div className={styles.content}>
        <Warning size={16} weight="fill" className={styles.icon} />
        <span className={styles.text}>
          Your provider does not support <code>/v1/completions</code>. Reasoning-off mode is using
          chat completions instead. For best compatibility, use <strong>LM Studio</strong>.
        </span>
      </div>
      <Button
        variant="ghost"
        className={styles.dismissButton}
        onClick={onDismiss}
        data-testid="ai-compat-warning-dismiss"
      >
        Dismiss
      </Button>
    </div>
  )
}
