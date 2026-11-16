import { getHours, getMinutes, getSeconds, isValid, parse, set, startOfToday } from 'date-fns'
import { formatMysqlDate, type TemporalColumnType } from '../../../lib/date-utils'

const MIDNIGHT_TIME_INPUT = '00:00:00'
const TIME_INPUT_FORMAT = 'H:m:s'
const SELECTED_DAY_SELECTOR = '.react-datepicker__day[tabindex="0"]'
const FIRST_CONTROL_SELECTOR = 'button, [tabindex]:not([tabindex="-1"]), input'

export interface TimeOfDay {
  hours: number
  minutes: number
  seconds: number
}

function timeOfDay(date: Date): TimeOfDay {
  return { hours: getHours(date), minutes: getMinutes(date), seconds: getSeconds(date) }
}

export function parseTimeInput(input: string): TimeOfDay | null {
  const parsed = parse(input, TIME_INPUT_FORMAT, startOfToday())
  if (!isValid(parsed)) return null
  return timeOfDay(parsed)
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

export function withTimeOfDayOf(target: Date, source: Date): Date {
  return set(target, timeOfDay(source))
}

export function withTimeOfDay(target: Date, time: TimeOfDay): Date {
  return set(target, time)
}

interface CurrentTimeOfDay {
  localDate: Date | null
  timeInput: string
}

export function withCurrentTimeOfDay(target: Date, current: CurrentTimeOfDay): Date {
  if (current.localDate) return withTimeOfDayOf(target, current.localDate)
  const parsed = parseTimeInput(current.timeInput)
  if (!parsed) return target
  return withTimeOfDay(target, parsed)
}

export function focusInitialPickerControl(popup: HTMLElement | null): void {
  if (!popup) return
  const focusable =
    popup.querySelector<HTMLElement>(SELECTED_DAY_SELECTOR) ??
    popup.querySelector<HTMLElement>(FIRST_CONTROL_SELECTOR)
  focusable?.focus()
}
