import { differenceInCalendarDays, format, isValid, parse } from 'date-fns'
import { isObjectRecord } from '../../../lib/value-checks'

export const DATE_FORMAT = 'yyyy-MM-dd'
export const MAX_RANGE_DAYS = 7

export interface LogDateRange {
  from: Date | null
  to: Date | null
}

export const EMPTY_LOG_DATE_RANGE: LogDateRange = { from: null, to: null }

export function formatDate(date: Date): string {
  return format(date, DATE_FORMAT)
}

export function parseInputDate(value: string): Date | null {
  const parsed = parse(value, DATE_FORMAT, new Date())
  if (!isValid(parsed)) {
    return null
  }

  const isCanonicalDate = formatDate(parsed) === value
  return isCanonicalDate ? parsed : null
}

export function getEventInputValue(event: unknown): string | null {
  if (!isObjectRecord(event)) {
    return null
  }
  const target = event.target
  if (!isObjectRecord(target)) {
    return null
  }
  const inputValue = target.value
  return typeof inputValue === 'string' ? inputValue : null
}

export function getValidationMessage(from: Date | null, to: Date | null): string | null {
  const isRangeIncomplete = !from || !to
  if (isRangeIncomplete) {
    return 'Select both a start and end date.'
  }

  const rangeDays = differenceInCalendarDays(to, from)
  if (rangeDays >= MAX_RANGE_DAYS) {
    return 'Select a date range of 7 days or fewer.'
  }

  return null
}
