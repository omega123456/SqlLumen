import { Button } from '../../common/Button'
import styles from '../DiffOverlay.module.css'

interface DiffOverlayHeaderProps {
  onReject: () => void
  onAcceptAll: () => void
}

export function DiffOverlayHeader({ onReject, onAcceptAll }: DiffOverlayHeaderProps) {
  return (
    <div className={styles.header}>
      <span className={styles.title}>Review changes</span>
      <div className={styles.actions}>
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
      </div>
    </div>
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
    <div className={styles.footer}>
      <div className={styles.actions}>
        <Button
          size="sm"
          onClick={onClose}
          title={closeLabel}
          aria-label={closeLabel}
          data-testid="diff-close-button"
        >
          Close
        </Button>
      </div>
    </div>
  )
}
