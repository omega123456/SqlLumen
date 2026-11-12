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

import { useState, useRef, useEffect, useEffectEvent, useCallback } from 'react'
import { createPortal } from 'react-dom'
import DatePicker from 'react-datepicker'
import { CaretLeft, CaretRight } from '@phosphor-icons/react'
import { parseMysqlDate, formatMysqlDate, type TemporalColumnType } from '../../lib/date-utils'
import { subscribeToTabDeactivated } from '../../lib/workspace-tab-activity-events'
import { HOURS_PER_DAY, MINUTES_PER_HOUR, SECONDS_PER_MINUTE } from '../../lib/units'
import { TextInput } from '../common/TextInput'
import { useDismissOnOutsideClick } from '../connection-dialog/useDismissOnOutsideClick'
import { Button } from '../common/Button'
import styles from './DateTimePicker.module.css'

import 'react-datepicker/dist/react-datepicker.css'

const INITIAL_FOCUS_DELAY_MS = 50
const MIDNIGHT_TIME_INPUT = '00:00:00'
const ESTIMATED_POPUP_HEIGHT_PX = 380
const POPUP_WIDTH_PX = 300
const ANCHOR_GAP_PX = 4
const VIEWPORT_EDGE_MARGIN_PX = 8
const MINIMUM_LEFT_PX = 4
const LAST_HOUR_OF_DAY = HOURS_PER_DAY - 1
const LAST_MINUTE_OF_HOUR = MINUTES_PER_HOUR - 1
const LAST_SECOND_OF_MINUTE = SECONDS_PER_MINUTE - 1

interface PopupPosition {
  top: number
  left: number
  flipUp: boolean
}

const UNANCHORED_POPUP_POSITION: PopupPosition = { top: 0, left: 0, flipUp: false }

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
  /** Called with the formatted MySQL string when the user applies or selects a date. */
  onApply: (value: string) => void
  /** Called when the user cancels (click outside, Escape, or Cancel button). */
  onCancel: () => void
  /** Owning workspace tab, used to dismiss the portal when the tab deactivates. */
  workspaceTabId?: string
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
  const isValidTime =
    isWithinRange(hours, LAST_HOUR_OF_DAY) &&
    isWithinRange(minutes, LAST_MINUTE_OF_HOUR) &&
    isWithinRange(seconds, LAST_SECOND_OF_MINUTE)
  if (!isValidTime) return null
  return { hours, minutes, seconds }
}

function isWithinRange(value: number, maximum: number): boolean {
  return value >= 0 && value <= maximum
}

/** Format a Date as HH:mm:ss using date-utils. Falls back to '00:00:00'. */
function formatTime(date: Date): string {
  return formatMysqlDate(date, 'TIME') ?? MIDNIGHT_TIME_INPUT
}

function formatTimeInput(date: Date | null): string {
  return date ? formatTime(date) : MIDNIGHT_TIME_INPUT
}

const CALENDAR_COLUMN_TYPES = new Set<TemporalColumnType>(['DATE', 'DATETIME', 'TIMESTAMP'])
const TIME_OF_DAY_COLUMN_TYPES = new Set<TemporalColumnType>(['DATETIME', 'TIMESTAMP', 'TIME'])

function copyTimeOfDay(target: Date, source: Date): void {
  target.setHours(source.getHours(), source.getMinutes(), source.getSeconds())
}

interface CurrentTimeOfDay {
  localDate: Date | null
  timeInput: string
}

function applyCurrentTimeOfDay(target: Date, current: CurrentTimeOfDay): void {
  if (current.localDate) {
    copyTimeOfDay(target, current.localDate)
    return
  }
  const parsed = parseTimeInput(current.timeInput)
  if (parsed) {
    target.setHours(parsed.hours, parsed.minutes, parsed.seconds)
  }
}

function shouldFlipAbove(anchorRect: DOMRect): boolean {
  const spaceBelow = window.innerHeight - anchorRect.bottom
  const fitsBelow = spaceBelow >= ESTIMATED_POPUP_HEIGHT_PX
  const fitsAbove = anchorRect.top > ESTIMATED_POPUP_HEIGHT_PX
  return !fitsBelow && fitsAbove
}

function popupTop(anchorRect: DOMRect, flipUp: boolean): number {
  if (flipUp) return anchorRect.top - ESTIMATED_POPUP_HEIGHT_PX - ANCHOR_GAP_PX
  return anchorRect.bottom + ANCHOR_GAP_PX
}

function popupLeft(anchorRect: DOMRect): number {
  const overflowsViewport = anchorRect.left + POPUP_WIDTH_PX > window.innerWidth
  const left = overflowsViewport
    ? window.innerWidth - POPUP_WIDTH_PX - VIEWPORT_EDGE_MARGIN_PX
    : anchorRect.left
  return Math.max(left, MINIMUM_LEFT_PX)
}

function computePopupPosition(anchorElement: HTMLElement): PopupPosition {
  const anchorRect = anchorElement.getBoundingClientRect()
  const flipUp = shouldFlipAbove(anchorRect)
  return { top: popupTop(anchorRect, flipUp), left: popupLeft(anchorRect), flipUp: flipUp }
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
      <Button
        variant="bare"
        className={styles.navArrow}
        onClick={decreaseMonth}
        aria-label="Previous month"
        data-testid="btn-prev-month"
      >
        <CaretLeft size={16} weight="bold" />
      </Button>
      <span className={styles.monthYearLabel}>{monthYear}</span>
      <Button
        variant="bare"
        className={styles.navArrow}
        onClick={increaseMonth}
        aria-label="Next month"
        data-testid="btn-next-month"
      >
        <CaretRight size={16} weight="bold" />
      </Button>
      <Button
        variant="bare"
        className={styles.todayLink}
        onClick={onTodayClick}
        data-testid="btn-today"
      >
        TODAY
      </Button>
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
  workspaceTabId,
}: DateTimePickerProps) {
  // Parse initial value
  const initialDate = parseMysqlDate(value, columnType)
  const [localDate, setLocalDate] = useState<Date | null>(initialDate)
  const [timeInput, setTimeInput] = useState<string>(formatTimeInput(initialDate))
  const internalPopupRef = useRef<HTMLDivElement>(null)

  // Callback ref that sets both the internal ref and the optional external ref.
  const mergedPopupRef = useCallback(
    (node: HTMLDivElement | null) => {
      internalPopupRef.current = node
      if (externalPopupRef) {
        externalPopupRef.current = node
      }
    },
    [externalPopupRef]
  )

  const showCalendar = CALENDAR_COLUMN_TYPES.has(columnType)
  const showTime = TIME_OF_DAY_COLUMN_TYPES.has(columnType)

  const [syncedValue, setSyncedValue] = useState(value)
  const applyExternalValue = (externalValue: string | null) => {
    const parsed = parseMysqlDate(externalValue, columnType)
    setLocalDate(parsed)
    if (showTime) {
      setTimeInput(formatTimeInput(parsed))
    }
  }
  if (value !== syncedValue) {
    setSyncedValue(value)
    applyExternalValue(value)
  }

  const [position, setPosition] = useState<PopupPosition>(UNANCHORED_POPUP_POSITION)

  useEffect(() => {
    if (!anchorEl) {
      onCancel()
      return
    }
    const measureFrame = requestAnimationFrame(() => {
      setPosition(computePopupPosition(anchorEl))
    })
    return () => cancelAnimationFrame(measureFrame)
  }, [anchorEl, onCancel])

  // --- Click outside (delegated to shared hook) ---
  useDismissOnOutsideClick(internalPopupRef, !disabled, onCancel)

  useEffect(() => {
    if (!workspaceTabId) {
      return
    }

    return subscribeToTabDeactivated(workspaceTabId, onCancel)
  }, [onCancel, workspaceTabId])

  // --- Auto-focus: move focus into the picker so keyboard navigation works ---
  // react-datepicker natively handles arrow keys, Page Up/Down, Enter/Space
  // for day selection when the calendar has focus. A small delay lets the
  // portal and positioning settle before we shift focus.
  const scheduleInitialFocus = useEffectEvent((): ReturnType<typeof setTimeout> | undefined => {
    if (disabled) return undefined
    return setTimeout(() => {
      if (!internalPopupRef.current) return
      // Prefer the selected day (react-datepicker's roving tabindex) so arrow keys move the
      // date; fall back to the first control only when no day is focusable.
      const focusable =
        internalPopupRef.current.querySelector<HTMLElement>(
          '.react-datepicker__day[tabindex="0"]'
        ) ??
        internalPopupRef.current.querySelector<HTMLElement>(
          'button, [tabindex]:not([tabindex="-1"]), input'
        )
      if (focusable) focusable.focus()
    }, INITIAL_FOCUS_DELAY_MS)
  })

  useEffect(() => {
    const initialFocusTimer = scheduleInitialFocus()
    return () => clearTimeout(initialFocusTimer)
  }, [])

  // --- Keyboard ---
  // Only Escape is handled at the picker level. Enter/Space within the calendar
  // grid is handled natively by react-datepicker for day selection. To apply,
  // the user must Tab to the Apply button and press Enter/Space there.
  useEffect(() => {
    if (disabled) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
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

      const nextDate = new Date(date)
      if (showTime) {
        applyCurrentTimeOfDay(nextDate, { localDate: localDate, timeInput: timeInput })
      }

      setLocalDate(nextDate)
      const formatted = formatMysqlDate(nextDate, columnType)
      if (formatted !== null) {
        onApply(formatted)
      }
    },
    [showTime, localDate, timeInput, columnType, onApply]
  )

  const handleTimeInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value
      setTimeInput(value)

      const parsed = parseTimeInput(value)
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
      return
    }
    // Set to today, preserving current time if applicable
    const today = new Date()
    if (showTime && localDate) {
      copyTimeOfDay(today, localDate)
    }
    setLocalDate(today)
    if (showTime) {
      setTimeInput(formatTime(today))
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
      className={`${styles.pickerPortal} click-outside-ignore ${disabled ? styles.disabled : ''}`}
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
              className={`ui-field-chrome ${styles.timeInput}`}
              value={timeInput}
              onChange={handleTimeInputChange}
              placeholder="HH:MM:SS"
              disabled={disabled}
              data-testid="time-input"
            />
          </div>
        )}

        <div className={styles.buttonRow}>
          <Button
            variant="bare"
            className={styles.cancelButton}
            onClick={onCancel}
            disabled={disabled}
            data-testid="btn-picker-cancel"
          >
            Cancel
          </Button>
          <Button
            variant="bare"
            className={`${styles.applyButton} ${localDate === null ? styles.applyButtonDisabled : ''}`}
            onClick={handleApply}
            disabled={disabled || localDate === null}
            data-testid="btn-picker-apply"
          >
            Apply
          </Button>
        </div>
      </div>
    </div>
  )

  return createPortal(popup, document.body)
}
