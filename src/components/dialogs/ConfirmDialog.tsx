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
  /** When true, prevent dismissal via Cancel button, Escape key, and backdrop click. */
  nonDismissible?: boolean
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
  nonDismissible = false,
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
      nonDismissible={nonDismissible}
    >
      <h2 className={styles.title}>
        <span className={styles.titleIcon}>
          <Warning size={22} weight="fill" />
        </span>
        {title}
      </h2>
      <div className={styles.message}>{message}</div>
      {resolvedWarning !== null && <p className={styles.warning}>{resolvedWarning}</p>}
      {error && (
        <div className={styles.error} data-testid="confirm-dialog-error">
          {error}
        </div>
      )}
      <div className={styles.actions}>
        <Button
          variant="secondary"
          onClick={onCancel}
          disabled={nonDismissible}
          data-testid="confirm-cancel-button"
        >
          Cancel
        </Button>
        <Button
          variant={isDestructive ? 'danger' : 'primary'}
          onClick={onConfirm}
          disabled={isLoading}
          data-testid="confirm-confirm-button"
        >
          {isLoading ? (
            <span className={styles.confirmContent}>
              <span className={styles.spinner} aria-hidden="true" />
              Processing...
            </span>
          ) : (
            confirmLabel
          )}
        </Button>
      </div>
    </DialogShell>
  )
}
