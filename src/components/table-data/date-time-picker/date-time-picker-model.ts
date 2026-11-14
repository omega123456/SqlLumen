import { formatMysqlDate, type TemporalColumnType } from '../../../lib/date-utils'
import { HOURS_PER_DAY, MINUTES_PER_HOUR, SECONDS_PER_MINUTE } from '../../../lib/units'

const MIDNIGHT_TIME_INPUT = '00:00:00'
const LAST_HOUR_OF_DAY = HOURS_PER_DAY - 1
const LAST_MINUTE_OF_HOUR = MINUTES_PER_HOUR - 1
const LAST_SECOND_OF_MINUTE = SECONDS_PER_MINUTE - 1
const SELECTED_DAY_SELECTOR = '.react-datepicker__day[tabindex="0"]'
const FIRST_CONTROL_SELECTOR = 'button, [tabindex]:not([tabindex="-1"]), input'

export function parseTimeInput(
  input: string
): { hours: number; minutes: number; seconds: number } | null {
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

export function formatTime(date: Date): string {
  return formatMysqlDate(date, 'TIME') ?? MIDNIGHT_TIME_INPUT
}

export function formatTimeInput(date: Date | null): string {
  return date ? formatTime(date) : MIDNIGHT_TIME_INPUT
}

export const CALENDAR_COLUMN_TYPES = new Set<TemporalColumnType>(['DATE', 'DATETIME', 'TIMESTAMP'])
export const TIME_OF_DAY_COLUMN_TYPES = new Set<TemporalColumnType>([
  'DATETIME',
  'TIMESTAMP',
  'TIME',
])

export function copyTimeOfDay(target: Date, source: Date): void {
  target.setHours(source.getHours(), source.getMinutes(), source.getSeconds())
}

interface CurrentTimeOfDay {
  localDate: Date | null
  timeInput: string
}

export function applyCurrentTimeOfDay(target: Date, current: CurrentTimeOfDay): void {
  if (current.localDate) {
    copyTimeOfDay(target, current.localDate)
    return
  }
  const parsed = parseTimeInput(current.timeInput)
  if (parsed) {
    target.setHours(parsed.hours, parsed.minutes, parsed.seconds)
  }
}

export function focusInitialPickerControl(popup: HTMLElement | null): void {
  if (!popup) return
  const focusable =
    popup.querySelector<HTMLElement>(SELECTED_DAY_SELECTOR) ??
    popup.querySelector<HTMLElement>(FIRST_CONTROL_SELECTOR)
  focusable?.focus()
}
