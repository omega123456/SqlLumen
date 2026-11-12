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
  /**
   * When true, the Cancel button is not rendered and the confirm button sits
   * alone in the right-hand action slot (e.g. an "OK" acknowledgement).
   * Escape and the backdrop still call `onCancel`.
   */
  hideCancel?: boolean
  onConfirm: () => void
  onCancel: () => void
}

const DEFAULT_WARNING_TEXT = 'This action cannot be undone.'

function resolveWarningText(warningText: string | null | undefined): string | null {
  if (warningText === undefined) return DEFAULT_WARNING_TEXT
  return warningText
}

function actionsClassName(hideCancel: boolean): string {
  if (!hideCancel) return styles.actions
  return `${styles.actions} ${styles.actionsSingle}`
}

function ConfirmButtonContent({ isLoading, label }: { isLoading: boolean; label: string }) {
  if (!isLoading) return <>{label}</>
  return (
    <span className={styles.confirmContent}>
      <span className={styles.spinner} aria-hidden="true" />
      Processing...
    </span>
  )
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
  hideCancel = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const resolvedWarning = resolveWarningText(warningText)
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
      <div className={actionsClassName(hideCancel)}>
        <Button
          ref={confirmButtonRef}
          variant={isDestructive ? 'danger' : 'accent'}
          onClick={onConfirm}
          disabled={isLoading}
          data-testid="confirm-confirm-button"
        >
          <ConfirmButtonContent isLoading={isLoading} label={confirmLabel} />
        </Button>
        {!hideCancel && (
          <Button onClick={onCancel} disabled={nonDismissible} data-testid="confirm-cancel-button">
            Cancel
          </Button>
        )}
      </div>
    </DialogShell>
  )
}
