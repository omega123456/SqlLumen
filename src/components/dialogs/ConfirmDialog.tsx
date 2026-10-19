import { useRef } from 'react'
import { Button } from '../common/Button'
import { DialogShell } from './DialogShell'
import styles from './ConfirmDialog.module.css'

export interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  message: React.ReactNode
  portalRoot?: HTMLElement | null
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
  portalRoot,
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
  const confirmButtonRef = useRef<HTMLButtonElement>(null)

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onCancel}
      portalRoot={portalRoot}
      maxWidth={440}
      fillMaxWidth
      testId="confirm-dialog"
      ariaLabel={title}
      nonDismissible={nonDismissible}
      initialFocusRef={confirmButtonRef}
    >
      <h2 className={styles.title}>{title}</h2>
      <div className={styles.message}>{message}</div>
      {resolvedWarning !== null && <p className={styles.warning}>{resolvedWarning}</p>}
      {error && (
        <div className={styles.error} data-testid="confirm-dialog-error">
          {error}
        </div>
      )}
      <div className={styles.actions}>
        <Button
          ref={confirmButtonRef}
          variant={isDestructive ? 'danger' : 'accent'}
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
        <Button onClick={onCancel} disabled={nonDismissible} data-testid="confirm-cancel-button">
          Cancel
        </Button>
      </div>
    </DialogShell>
  )
}
