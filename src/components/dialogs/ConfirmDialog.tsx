import { Warning } from '@phosphor-icons/react'
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
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmButtonClass = isDestructive ? styles.destructiveButton : 'ui-button-primary'

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
      <p className={styles.warning}>This action cannot be undone.</p>
      {error && (
        <div className={styles.error} data-testid="confirm-dialog-error">
          {error}
        </div>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          className="ui-button-secondary"
          onClick={onCancel}
          data-testid="confirm-cancel-button"
        >
          Cancel
        </button>
        <button
          type="button"
          className={confirmButtonClass}
          onClick={onConfirm}
          disabled={isLoading}
          data-testid="confirm-confirm-button"
        >
          {isLoading ? 'Processing...' : confirmLabel}
        </button>
      </div>
    </DialogShell>
  )
}
