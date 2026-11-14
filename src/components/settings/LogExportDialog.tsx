import { Button } from '../common/Button'
import { DialogShell } from '../dialogs/DialogShell'
import styles from './LogExportDialog.module.css'
import 'react-datepicker/dist/react-datepicker.css'
import { LogDateField } from './log-export-dialog/LogDateField'
import { useLogExport } from './log-export-dialog/use-log-export'

export interface LogExportDialogProps {
  isOpen: boolean
  onClose: () => void
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
      <div className={styles.root}>
        <div className={styles.header}>
          <h2 className={styles.title}>Export logs</h2>
          <p className={styles.subtitle}>Choose a date range of up to 7 days and save it as CSV.</p>
        </div>

        <div className={styles.body}>
          <LogDateField edge="from" {...fieldProps} />
          <LogDateField edge="to" {...fieldProps} />

          <p
            className={validationMessage === null ? styles.helperText : styles.validationMessage}
            data-testid="log-export-validation"
          >
            {validationMessage ?? 'Up to 7 days inclusive.'}
          </p>
        </div>

        <div className={styles.footer}>
          <Button
            variant="accent"
            type="submit"
            disabled={!logExport.canExport}
            data-testid="log-export-submit-button"
          >
            <span className={styles.actionContent}>
              {busy && <span className={styles.spinner} aria-hidden="true" />}
              {busy ? 'Exporting...' : 'Export'}
            </span>
          </Button>
          <Button onClick={onClose} disabled={busy} data-testid="log-export-cancel-button">
            Cancel
          </Button>
        </div>
      </div>
    </DialogShell>
  )
}
