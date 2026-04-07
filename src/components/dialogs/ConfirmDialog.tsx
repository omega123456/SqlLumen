import { Warning } from '@phosphor-icons/react'
import { Button } from '../common/Button'
import { DialogShell } from './DialogShell'
import styles from './ConfirmDialog.module.css'

export interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  message: React.ReactNode
  confirmLabel: string
  isDestructive?: boolean
  isLoading?: boolean
  error?: string | null
  /** Warning text below the message. Defaults to "This action cannot be undone." Pass `null` to hide. */
  warningText?: string | null
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel,
  isDestructive = false,
  isLoading = false,
  error,
  warningText,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const resolvedWarning = warningText === undefined ? 'This action cannot be undone.' : warningText
  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onCancel}
      maxWidth={420}
      testId="confirm-dialog"
      ariaLabel={title}
    >
      <h2 className={styles.title}>
        <span className={styles.titleIcon}>
          <Warning size={22} weight="fill" />
        </span>
        {title}
      </h2>
      <p className={styles.message}>{message}</p>
      {resolvedWarning !== null && <p className={styles.warning}>{resolvedWarning}</p>}
      {error && (
        <div className={styles.error} data-testid="confirm-dialog-error">
          {error}
        </div>
      )}
      <div className={styles.actions}>
        <Button variant="secondary" onClick={onCancel} data-testid="confirm-cancel-button">
          Cancel
        </Button>
        <Button
          variant={isDestructive ? 'danger' : 'primary'}
          onClick={onConfirm}
          disabled={isLoading}
          data-testid="confirm-confirm-button"
        >
          {isLoading ? 'Processing...' : confirmLabel}
        </Button>
      </div>
    </DialogShell>
  )
}
