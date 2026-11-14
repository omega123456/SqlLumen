import { useCallback, useState, type ChangeEvent } from 'react'
import { parseMysqlDate, formatMysqlDate, type TemporalColumnType } from '../../../lib/date-utils'
import {
  TIME_OF_DAY_COLUMN_TYPES,
  applyCurrentTimeOfDay,
  copyTimeOfDay,
  formatTime,
  formatTimeInput,
  parseTimeInput,
} from './date-time-picker-model'

interface PickerValueInputs {
  value: string | null
  columnType: TemporalColumnType
  onApply: (value: string) => void
}

function applyFormatted(
  date: Date,
  columnType: TemporalColumnType,
  onApply: (value: string) => void
) {
  const formatted = formatMysqlDate(date, columnType)
  if (formatted !== null) onApply(formatted)
}

function usePickerState({ value, columnType }: PickerValueInputs) {
  const initialDate = parseMysqlDate(value, columnType)
  const [localDate, setLocalDate] = useState<Date | null>(initialDate)
  const [timeInput, setTimeInput] = useState<string>(formatTimeInput(initialDate))
  const [syncedValue, setSyncedValue] = useState(value)
  const showTime = TIME_OF_DAY_COLUMN_TYPES.has(columnType)
  if (value !== syncedValue) {
    setSyncedValue(value)
    const parsed = parseMysqlDate(value, columnType)
    setLocalDate(parsed)
    if (showTime) setTimeInput(formatTimeInput(parsed))
  }
  return { localDate, setLocalDate, timeInput, setTimeInput, showTime }
}

export function usePickerValue(inputs: PickerValueInputs) {
  const { columnType, onApply } = inputs
  const { localDate, setLocalDate, timeInput, setTimeInput, showTime } = usePickerState(inputs)

  const handleDateChange = useCallback(
    (date: Date | null) => {
      if (!date) {
        setLocalDate(null)
        return
      }
      const nextDate = new Date(date)
      if (showTime) applyCurrentTimeOfDay(nextDate, { localDate: localDate, timeInput: timeInput })
      setLocalDate(nextDate)
      applyFormatted(nextDate, columnType, onApply)
    },
    [showTime, localDate, timeInput, columnType, onApply, setLocalDate]
  )

  const handleTimeInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const nextInput = event.target.value
      setTimeInput(nextInput)
      const parsed = parseTimeInput(nextInput)
      if (!parsed) return
      const newDate = localDate ? new Date(localDate) : new Date()
      newDate.setHours(parsed.hours, parsed.minutes, parsed.seconds)
      setLocalDate(newDate)
    },
    [localDate, setLocalDate, setTimeInput]
  )

  const handleTodayClick = useCallback(() => {
    const now = new Date()
    if (columnType === 'TIME') {
      setLocalDate(now)
      setTimeInput(formatTime(now))
      return
    }
    const today = new Date()
    if (!showTime) {
      setLocalDate(today)
      return
    }
    if (localDate) copyTimeOfDay(today, localDate)
    setLocalDate(today)
    setTimeInput(formatTime(today))
  }, [columnType, showTime, localDate, setLocalDate, setTimeInput])

  const handleApply = useCallback(() => {
    if (localDate === null) return
    applyFormatted(localDate, columnType, onApply)
  }, [localDate, columnType, onApply])

  return {
    localDate,
    timeInput,
    showTime,
    handleDateChange,
    handleTimeInputChange,
    handleTodayClick,
    handleApply,
  }
}
