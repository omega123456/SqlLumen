import { useRef } from 'react'
import { Button } from '../common/Button'
import { DialogShell } from './DialogShell'
import { DIALOG_FOOTER_GRID, DIALOG_TITLE } from '../../lib/class-names-dialog'
import { joinClassNames } from '../../lib/class-names'

export type ConfirmDialogFocus = 'confirm' | 'cancel'

export interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  message: React.ReactNode
  portalRoot?: HTMLElement | null
  confirmLabel: string
  isDestructive?: boolean
  isLoading?: boolean
  error?: string | null
  warningText?: string | null
  nonDismissible?: boolean
  hideCancel?: boolean
  initialFocus?: ConfirmDialogFocus
  onConfirm: () => void
  onCancel: () => void
}

const DEFAULT_WARNING_TEXT = 'This action cannot be undone.'

function resolveWarningText(warningText: string | null | undefined): string | null {
  if (warningText === undefined) return DEFAULT_WARNING_TEXT
  return warningText
}

function ConfirmWarning({ warningText }: { warningText: string | null | undefined }) {
  const resolvedWarning = resolveWarningText(warningText)
  if (resolvedWarning === null) return null
  return (
    <p className="mt-3 text-body text-light-on-surface-variant dark:text-dark-on-surface-variant wrap-break-word">
      {resolvedWarning}
    </p>
  )
}

function ConfirmButtonContent({ isLoading, label }: { isLoading: boolean; label: string }) {
  if (!isLoading) return <>{label}</>
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className="size-3.5 animate-spin-700ms rounded-round border-2 border-current border-r-transparent opacity-90 window-blurred:animate-spin-700ms-paused"
        aria-hidden="true"
      />
      Processing...
    </span>
  )
}

function ConfirmError({ error }: { error: string | null | undefined }) {
  if (!error) return null
  return (
    <div
      className="mt-3 rounded-card border border-light-stroke-card bg-light-error-container px-3 py-2 text-size-row text-light-error dark:border-dark-stroke-card dark:bg-dark-error-container dark:text-dark-error"
      data-testid="confirm-dialog-error"
    >
      {error}
    </div>
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
  initialFocus = 'confirm',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const initialFocusRef = initialFocus === 'cancel' ? cancelButtonRef : confirmButtonRef

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
      initialFocusRef={initialFocusRef}
    >
      <h2 className={DIALOG_TITLE}>{title}</h2>
      <div className="text-body text-light-on-surface dark:text-dark-on-surface">{message}</div>
      <ConfirmWarning warningText={warningText} />
      <ConfirmError error={error} />
      <div className={joinClassNames([DIALOG_FOOTER_GRID, 'mt-6 *:only:col-start-2'])}>
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
          <Button
            ref={cancelButtonRef}
            onClick={onCancel}
            disabled={nonDismissible}
            data-testid="confirm-cancel-button"
          >
            Cancel
          </Button>
        )}
      </div>
    </DialogShell>
  )
}
