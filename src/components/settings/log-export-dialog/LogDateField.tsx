import { forwardRef, type InputHTMLAttributes } from 'react'
import { addDays } from 'date-fns'
import DatePicker from 'react-datepicker'
import { TextInput } from '../../common/TextInput'
import { DATE_FORMAT, MAX_RANGE_DAYS, type LogDateRange } from './log-export-model'
import styles from '../LogExportDialog.module.css'

const LAST_DAY_OFFSET = MAX_RANGE_DAYS - 1

type DateInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  invalid?: boolean
}

const DateInput = forwardRef<HTMLInputElement, DateInputProps>(function DateInput(
  { invalid = false, ...props },
  ref
) {
  return <TextInput ref={ref} variant="formField" invalid={invalid} {...props} />
})

type RangeEdge = keyof LogDateRange

interface DateBounds {
  minDate: Date | undefined
  maxDate: Date | undefined
}

function boundsForEdge(edge: RangeEdge, { from, to }: LogDateRange): DateBounds {
  if (edge === 'from') {
    return {
      minDate: to ? addDays(to, -LAST_DAY_OFFSET) : undefined,
      maxDate: to ?? undefined,
    }
  }
  return {
    minDate: from ?? undefined,
    maxDate: from ? addDays(from, LAST_DAY_OFFSET) : undefined,
  }
}

const EDGE_LABELS: Record<RangeEdge, string> = { from: 'From', to: 'To' }

export interface LogDateFieldProps {
  edge: RangeEdge
  range: LogDateRange
  isInvalid: boolean
  disabled: boolean
  onChange: (edge: RangeEdge, date: Date | null) => void
  onChangeRaw: (edge: RangeEdge, event: unknown) => void
}

export function LogDateField({
  edge,
  range,
  isInvalid,
  disabled,
  onChange,
  onChangeRaw,
}: LogDateFieldProps) {
  const inputId = `log-export-${edge}`
  const bounds = boundsForEdge(edge, range)
  return (
    <div className={styles.fieldGroup}>
      <label className={styles.label} htmlFor={inputId}>
        {EDGE_LABELS[edge]}
      </label>
      <DatePicker
        id={inputId}
        selected={range[edge]}
        onChange={(date: Date | null) => onChange(edge, date)}
        selectsStart={edge === 'from'}
        selectsEnd={edge === 'to'}
        startDate={range.from}
        endDate={range.to}
        minDate={bounds.minDate}
        maxDate={bounds.maxDate}
        onChangeRaw={(event) => onChangeRaw(edge, event)}
        placeholderText="YYYY-MM-DD"
        dateFormat={DATE_FORMAT}
        customInput={<DateInput invalid={isInvalid} data-testid={`${inputId}-input`} />}
        calendarClassName={styles.calendar}
        wrapperClassName={styles.pickerWrapper}
        popperClassName={styles.popper}
        disabled={disabled}
      />
    </div>
  )
}
