/**
 * DateTimePicker — popup calendar/time picker for MySQL temporal columns.
 *
 * Renders as a portal-based popup positioned relative to an anchor element.
 * Supports three modes based on the MySQL column type:
 * - DATE: calendar only
 * - DATETIME / TIMESTAMP: calendar + time input
 * - TIME: time input only
 *
 * Communicates via props/callbacks only — no store access.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import DatePicker from 'react-datepicker'
import { CaretLeft, CaretRight } from '@phosphor-icons/react'
import { parseMysqlDate, formatMysqlDate, type TemporalColumnType } from '../../lib/date-utils'
import { TextInput } from '../common/TextInput'
import { useDismissOnOutsideClick } from '../connection-dialog/useDismissOnOutsideClick'
import styles from './DateTimePicker.module.css'

import 'react-datepicker/dist/react-datepicker.css'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DateTimePickerProps {
  /** MySQL-format string value, or null. */
  value: string | null
  /** Temporal column type from date-utils. */
  columnType: TemporalColumnType
  /** When true, picker is visually disabled and non-interactive. */
  disabled?: boolean
  /** Anchor element used for positioning the popup. */
  anchorEl: HTMLElement | null
  /** Optional ref that will be set to the popup's outermost portal element. */
  popupRef?: React.RefObject<HTMLDivElement | null>
  /** Called with the formatted MySQL string when the user clicks Apply. */
  onApply: (value: string) => void
  /** Called when the user cancels (click outside, Escape, or Cancel button). */
  onCancel: () => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseTimeInput(input: string): { hours: number; minutes: number; seconds: number } | null {
  const match = input.match(/^(\d{1,2}):(\d{1,2}):(\d{1,2})$/)
  if (!match) return null
  const hours = parseInt(match[1], 10)
  const minutes = parseInt(match[2], 10)
  const seconds = parseInt(match[3], 10)
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) {
    return null
  }
  return { hours, minutes, seconds }
}

/** Format a Date as HH:mm:ss using date-utils. Falls back to '00:00:00'. */
function formatTime(date: Date): string {
  return formatMysqlDate(date, 'TIME') ?? '00:00:00'
}

// ---------------------------------------------------------------------------
// Custom header for react-datepicker
// ---------------------------------------------------------------------------

interface CalendarHeaderProps {
  date: Date
  decreaseMonth: () => void
  increaseMonth: () => void
  onTodayClick: () => void
}

function CalendarHeader({ date, decreaseMonth, increaseMonth, onTodayClick }: CalendarHeaderProps) {
  const monthYear = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  return (
    <div className={styles.calendarHeader} data-testid="calendar-header">
      <button
        type="button"
        className={styles.navArrow}
        onClick={decreaseMonth}
        aria-label="Previous month"
        data-testid="btn-prev-month"
      >
        <CaretLeft size={16} weight="bold" />
      </button>
      <span className={styles.monthYearLabel}>{monthYear}</span>
      <button
        type="button"
        className={styles.navArrow}
        onClick={increaseMonth}
        aria-label="Next month"
        data-testid="btn-next-month"
      >
        <CaretRight size={16} weight="bold" />
      </button>
      <button
        type="button"
        className={styles.todayLink}
        onClick={onTodayClick}
        data-testid="btn-today"
      >
        TODAY
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DateTimePicker({
  value,
  columnType,
  disabled = false,
  anchorEl,
  popupRef: externalPopupRef,
  onApply,
  onCancel,
}: DateTimePickerProps) {
  // Parse initial value
  const initialDate = parseMysqlDate(value, columnType)
  const [localDate, setLocalDate] = useState<Date | null>(initialDate)
  const [timeInput, setTimeInput] = useState<string>(
    initialDate ? formatTime(initialDate) : '00:00:00'
  )
  const internalPopupRef = useRef<HTMLDivElement>(null)

  // Callback ref that sets both the internal ref and the optional external ref.
  const mergedPopupRef = useCallback(
    (node: HTMLDivElement | null) => {
      internalPopupRef.current = node
      if (externalPopupRef) {
        ;(externalPopupRef as React.MutableRefObject<HTMLDivElement | null>).current = node
      }
    },
    [externalPopupRef]
  )

  const [position, setPosition] = useState<{ top: number; left: number; flipUp: boolean }>({
    top: 0,
    left: 0,
    flipUp: false,
  })

  const showCalendar =
    columnType === 'DATE' || columnType === 'DATETIME' || columnType === 'TIMESTAMP'
  const showTime = columnType === 'DATETIME' || columnType === 'TIMESTAMP' || columnType === 'TIME'

  // --- Sync internal state when `value` prop changes externally ---
  // Uses a ref to track the previous value so we only sync when the parent
  // actually provides a new value, avoiding resetting mid-selection.
  const prevValueRef = useRef(value)
  useEffect(() => {
    if (value !== prevValueRef.current) {
      prevValueRef.current = value
      const parsed = parseMysqlDate(value, columnType)
      setLocalDate(parsed)
      if (showTime) {
        setTimeInput(parsed ? formatTime(parsed) : '00:00:00')
      }
    }
  }, [value, columnType, showTime])

  // --- Positioning ---
  useEffect(() => {
    if (!anchorEl) {
      onCancel() // Can't position without anchor
      return
    }

    const rect = anchorEl.getBoundingClientRect()
    const popupHeight = 380 // approximate height
    const spaceBelow = window.innerHeight - rect.bottom
    const flipUp = spaceBelow < popupHeight && rect.top > popupHeight

    let top: number
    if (flipUp) {
      top = rect.top - popupHeight - 4
    } else {
      top = rect.bottom + 4
    }

    // Ensure left doesn't overflow viewport
    let left = rect.left
    const popupWidth = 300
    if (left + popupWidth > window.innerWidth) {
      left = window.innerWidth - popupWidth - 8
    }
    if (left < 4) left = 4

    setPosition({ top, left, flipUp })
  }, [anchorEl, onCancel])

  // --- Click outside (delegated to shared hook) ---
  useDismissOnOutsideClick(internalPopupRef, !disabled, onCancel)

  // --- Auto-focus: move focus into the picker so keyboard navigation works ---
  // react-datepicker natively handles arrow keys, Page Up/Down, Enter/Space
  // for day selection when the calendar has focus. A small delay lets the
  // portal and positioning settle before we shift focus.
  useEffect(() => {
    if (disabled) return
    const timer = setTimeout(() => {
      if (!internalPopupRef.current) return
      const focusable = internalPopupRef.current.querySelector<HTMLElement>(
        'button, [tabindex]:not([tabindex="-1"]), input'
      )
      if (focusable) focusable.focus()
    }, 50)
    return () => clearTimeout(timer)
    // Only on mount — intentionally empty deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- Keyboard ---
  // Only Escape is handled at the picker level. Enter/Space within the calendar
  // grid is handled natively by react-datepicker for day selection. To apply,
  // the user must Tab to the Apply button and press Enter/Space there.
  useEffect(() => {
    if (disabled) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [disabled, onCancel])

  // --- Handlers ---

  const handleDateChange = useCallback(
    (date: Date | null) => {
      if (!date) {
        setLocalDate(null)
        return
      }

      // Preserve time from current localDate if we have one
      if (showTime && localDate) {
        date.setHours(localDate.getHours(), localDate.getMinutes(), localDate.getSeconds())
      } else if (showTime) {
        // Apply time from timeInput
        const parsed = parseTimeInput(timeInput)
        if (parsed) {
          date.setHours(parsed.hours, parsed.minutes, parsed.seconds)
        }
      }

      setLocalDate(date)
    },
    [showTime, localDate, timeInput]
  )

  const handleTimeInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value
      setTimeInput(val)

      const parsed = parseTimeInput(val)
      if (parsed) {
        const newDate = localDate ? new Date(localDate) : new Date()
        newDate.setHours(parsed.hours, parsed.minutes, parsed.seconds)
        setLocalDate(newDate)
      }
    },
    [localDate]
  )

  const handleTodayClick = useCallback(() => {
    const now = new Date()
    if (columnType === 'TIME') {
      setLocalDate(now)
      setTimeInput(formatTime(now))
    } else {
      // Set to today, preserving current time if applicable
      const today = new Date()
      if (showTime && localDate) {
        today.setHours(localDate.getHours(), localDate.getMinutes(), localDate.getSeconds())
      }
      setLocalDate(today)
      if (showTime) {
        setTimeInput(formatTime(today))
      }
    }
  }, [columnType, showTime, localDate])

  const handleApply = useCallback(() => {
    if (localDate === null) return // Nothing to apply
    const formatted = formatMysqlDate(localDate, columnType)
    if (formatted !== null) {
      onApply(formatted)
    }
  }, [localDate, columnType, onApply])

  // --- Render ---

  const popup = (
    <div
      ref={mergedPopupRef}
      className={`${styles.pickerPortal} ${disabled ? styles.disabled : ''}`}
      style={{ top: position.top, left: position.left }}
      data-testid="date-time-picker-popup"
    >
      <div className={styles.pickerWrapper}>
        {showCalendar && (
          <div className={styles.calendarSection} data-testid="calendar-section">
            <DatePicker
              selected={localDate}
              onChange={handleDateChange}
              inline
              shouldCloseOnSelect={false}
              renderCustomHeader={({ date, decreaseMonth, increaseMonth }) => (
                <CalendarHeader
                  date={date}
                  decreaseMonth={decreaseMonth}
                  increaseMonth={increaseMonth}
                  onTodayClick={handleTodayClick}
                />
              )}
            />
          </div>
        )}

        {showTime && (
          <div className={styles.timeSection} data-testid="time-section">
            <label className={styles.timeLabel}>TIME</label>
            <TextInput
              variant="bare"
              type="text"
              className={styles.timeInput}
              value={timeInput}
              onChange={handleTimeInputChange}
              placeholder="HH:MM:SS"
              disabled={disabled}
              data-testid="time-input"
            />
          </div>
        )}

        <div className={styles.buttonRow}>
          <button
            type="button"
            className={styles.cancelButton}
            onClick={onCancel}
            disabled={disabled}
            data-testid="btn-picker-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            className={`${styles.applyButton} ${localDate === null ? styles.applyButtonDisabled : ''}`}
            onClick={handleApply}
            disabled={disabled || localDate === null}
            data-testid="btn-picker-apply"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )

  return createPortal(popup, document.body)
}
