import { save } from '@tauri-apps/plugin-dialog'
import { addDays, differenceInCalendarDays, format, isValid, parse } from 'date-fns'
import {
  forwardRef,
  type InputHTMLAttributes,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import DatePicker from 'react-datepicker'
import { Button } from '../common/Button'
import { TextInput } from '../common/TextInput'
import { DialogShell } from '../dialogs/DialogShell'
import { exportLogs } from '../../lib/log-commands'
import { showErrorToast, showSuccessToast } from '../../stores/toast-store'
import styles from './LogExportDialog.module.css'

import 'react-datepicker/dist/react-datepicker.css'

const DATE_FORMAT = 'yyyy-MM-dd'
const MAX_RANGE_DAYS = 7

export interface LogExportDialogProps {
  isOpen: boolean
  onClose: () => void
}

function formatDate(date: Date): string {
  return format(date, DATE_FORMAT)
}

function parseInputDate(value: string): Date | null {
  const parsed = parse(value, DATE_FORMAT, new Date())
  if (!isValid(parsed)) {
    return null
  }

  return formatDate(parsed) === value ? parsed : null
}

function getEventInputValue(event: unknown): string | null {
  if (
    typeof event === 'object' &&
    event !== null &&
    'target' in event &&
    typeof event.target === 'object' &&
    event.target !== null &&
    'value' in event.target &&
    typeof event.target.value === 'string'
  ) {
    return event.target.value
  }

  return null
}

function getValidationMessage(from: Date | null, to: Date | null): string | null {
  if (!from || !to) {
    return 'Select both a start and end date.'
  }

  if (differenceInCalendarDays(to, from) >= MAX_RANGE_DAYS) {
    return 'Select a date range of 7 days or fewer.'
  }

  return null
}

type DateInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  invalid?: boolean
}

const DateInput = forwardRef<HTMLInputElement, DateInputProps>(function DateInput(
  { invalid = false, ...props },
  ref
) {
  return <TextInput ref={ref} variant="formField" invalid={invalid} {...props} />
})

export function LogExportDialog({ isOpen, onClose }: LogExportDialogProps) {
  const [from, setFrom] = useState<Date | null>(null)
  const [to, setTo] = useState<Date | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!isOpen) {
      setFrom(null)
      setTo(null)
      setBusy(false)
    }
  }, [isOpen])

  const validationMessage = useMemo(() => getValidationMessage(from, to), [from, to])
  const canExport = !busy && validationMessage === null

  const handleRawFromChange = useCallback((event: unknown) => {
    const nextValue = getEventInputValue(event)
    if (nextValue === null) {
      return
    }
    setFrom(parseInputDate(nextValue))
  }, [])

  const handleRawToChange = useCallback((event: unknown) => {
    const nextValue = getEventInputValue(event)
    if (nextValue === null) {
      return
    }
    setTo(parseInputDate(nextValue))
  }, [])

  const handleExport = useCallback(async () => {
    if (!from || !to || validationMessage !== null || busy) {
      return
    }

    const filePath = await save({
      defaultPath: `sqllumen_logs_${formatDate(from)}_${formatDate(to)}.csv`,
      filters: [{ name: 'CSV Files', extensions: ['csv'] }],
    })

    if (!filePath) {
      return
    }

    setBusy(true)
    try {
      await exportLogs(formatDate(from), formatDate(to), filePath)
      showSuccessToast('Export completed', `Logs saved to ${filePath}`)
      onClose()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      showErrorToast('Export failed', message)
    } finally {
      setBusy(false)
    }
  }, [busy, from, onClose, to, validationMessage])

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      maxWidth={480}
      nonDismissible={busy}
      ariaLabel="Export Logs"
      testId="log-export-dialog"
      panelPadding={false}
    >
      <div className={styles.root}>
        <div className={styles.header}>
          <h2 className={styles.title}>Export Logs</h2>
          <p className={styles.subtitle}>Choose a date range of up to 7 days and save it as CSV.</p>
        </div>

        <div className={styles.body}>
          <div className={styles.fieldGroup}>
            <label className={styles.label} htmlFor="log-export-from">
              From
            </label>
            <DatePicker
              id="log-export-from"
              selected={from}
              onChange={(date: Date | null) => setFrom(date)}
              selectsStart
              startDate={from}
              endDate={to}
              minDate={to ? addDays(to, -(MAX_RANGE_DAYS - 1)) : undefined}
              maxDate={to ?? undefined}
              onChangeRaw={handleRawFromChange}
              placeholderText="YYYY-MM-DD"
              dateFormat={DATE_FORMAT}
              customInput={
                <DateInput
                  invalid={validationMessage !== null}
                  data-testid="log-export-from-input"
                />
              }
              calendarClassName={styles.calendar}
              wrapperClassName={styles.pickerWrapper}
              popperClassName={styles.popper}
              disabled={busy}
            />
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.label} htmlFor="log-export-to">
              To
            </label>
            <DatePicker
              id="log-export-to"
              selected={to}
              onChange={(date: Date | null) => setTo(date)}
              selectsEnd
              startDate={from}
              endDate={to}
              minDate={from ?? undefined}
              maxDate={from ? addDays(from, MAX_RANGE_DAYS - 1) : undefined}
              onChangeRaw={handleRawToChange}
              placeholderText="YYYY-MM-DD"
              dateFormat={DATE_FORMAT}
              customInput={
                <DateInput invalid={validationMessage !== null} data-testid="log-export-to-input" />
              }
              calendarClassName={styles.calendar}
              wrapperClassName={styles.pickerWrapper}
              popperClassName={styles.popper}
              disabled={busy}
            />
          </div>

          <p
            className={validationMessage === null ? styles.helperText : styles.validationMessage}
            data-testid="log-export-validation"
          >
            {validationMessage ?? 'Up to 7 days inclusive.'}
          </p>
        </div>

        <div className={styles.footer}>
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={busy}
            data-testid="log-export-cancel-button"
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleExport}
            disabled={!canExport}
            data-testid="log-export-submit-button"
          >
            <span className={styles.actionContent}>
              {busy && <span className={styles.spinner} aria-hidden="true" />}
              {busy ? 'Exporting...' : 'Export'}
            </span>
          </Button>
        </div>
      </div>
    </DialogShell>
  )
}
