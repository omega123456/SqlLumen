import { Button } from '../common/Button'
import { DialogShell } from '../dialogs/DialogShell'
import { DIALOG_FOOTER_SURFACE, DIALOG_HEADER_TITLE } from '../../lib/class-names-dialog'
import { joinClassNames } from '../../lib/class-names'
import 'react-datepicker/dist/react-datepicker.css'
import { LogDateField } from './log-export-dialog/LogDateField'
import { useLogExport } from './log-export-dialog/use-log-export'

export interface LogExportDialogProps {
  isOpen: boolean
  onClose: () => void
}

type ValidationTone = 'helper' | 'invalid'

const VALIDATION_TONE_CLASSES: Record<ValidationTone, string> = {
  helper: 'text-light-on-surface-variant dark:text-dark-on-surface-variant',
  invalid: 'text-light-error dark:text-dark-error',
}

function validationToneOf(validationMessage: string | null): ValidationTone {
  if (validationMessage === null) return 'helper'
  return 'invalid'
}

interface LogExportFooterProps {
  logExport: ReturnType<typeof useLogExport>
  onClose: () => void
}

function LogExportFooter({ logExport, onClose }: LogExportFooterProps) {
  const { busy } = logExport
  return (
    <div className={joinClassNames([DIALOG_FOOTER_SURFACE, 'flex justify-end gap-2'])}>
      <Button
        variant="accent"
        type="submit"
        disabled={!logExport.canExport}
        data-testid="log-export-submit-button"
      >
        <span className="inline-flex items-center gap-2">
          {busy && (
            <span
              className="size-3.5 animate-spin-700ms rounded-round border-2 border-current border-r-transparent opacity-90 window-blurred:animate-spin-700ms-paused"
              aria-hidden="true"
            />
          )}
          {busy ? 'Exporting...' : 'Export'}
        </span>
      </Button>
      <Button onClick={onClose} disabled={busy} data-testid="log-export-cancel-button">
        Cancel
      </Button>
    </div>
  )
}

export function LogExportDialog({ isOpen, onClose }: LogExportDialogProps) {
  const logExport = useLogExport(isOpen, onClose)
  const { range, busy, validationMessage } = logExport
  const fieldProps = {
    range: range,
    isInvalid: validationMessage !== null,
    disabled: busy,
    onChange: logExport.setEdge,
    onChangeRaw: logExport.setEdgeFromRawInput,
  }

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      maxWidth={480}
      nonDismissible={busy}
      ariaLabel="Export logs"
      testId="log-export-dialog"
      panelPadding={false}
      formProps={{ onSubmit: logExport.handleSubmit }}
    >
      <div className="flex flex-col overflow-hidden rounded-overlay">
        <div className="px-6 pt-6">
          <h2 className={DIALOG_HEADER_TITLE}>Export logs</h2>
          <p className="mt-2 text-size-caption leading-body text-light-on-surface-variant dark:text-dark-on-surface-variant wrap-break-word">
            Choose a date range of up to 7 days and save it as CSV.
          </p>
        </div>

        <div className="flex flex-col gap-4.5 px-6 pt-3 pb-6">
          <LogDateField edge="from" {...fieldProps} />
          <LogDateField edge="to" {...fieldProps} />

          <p
            className={joinClassNames([
              'text-size-caption leading-compact wrap-break-word',
              VALIDATION_TONE_CLASSES[validationToneOf(validationMessage)],
            ])}
            data-testid="log-export-validation"
          >
            {validationMessage ?? 'Up to 7 days inclusive.'}
          </p>
        </div>

        <LogExportFooter logExport={logExport} onClose={onClose} />
      </div>
    </DialogShell>
  )
}
