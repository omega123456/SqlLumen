import { describe, expect, it } from 'vitest'
import {
  parseTimeInput,
  withCurrentTimeOfDay,
  withTimeOfDayOf,
} from '../../../../components/shared/date-time-picker/date-time-picker-model'

describe('parseTimeInput', () => {
  it('parses padded and unpadded H:m:s input', () => {
    expect(parseTimeInput('09:05:07')).toEqual({ hours: 9, minutes: 5, seconds: 7 })
    expect(parseTimeInput('1:2:3')).toEqual({ hours: 1, minutes: 2, seconds: 3 })
    expect(parseTimeInput('23:59:59')).toEqual({ hours: 23, minutes: 59, seconds: 59 })
  })
})

describe('time-of-day helpers', () => {
  const target = new Date(2026, 5, 6, 1, 2, 3)

  it('copies the time of day from another date without mutating the target', () => {
    const result = withTimeOfDayOf(target, new Date(2020, 0, 1, 14, 15, 16))

    expect(result).toEqual(new Date(2026, 5, 6, 14, 15, 16))
    expect(target).toEqual(new Date(2026, 5, 6, 1, 2, 3))
  })

  it('prefers the current local date, then the typed time, then leaves the target', () => {
    const fromLocalDate = withCurrentTimeOfDay(target, {
      localDate: new Date(2020, 0, 1, 4, 5, 6),
      timeInput: '07:08:09',
    })
    const fromInput = withCurrentTimeOfDay(target, { localDate: null, timeInput: '07:08:09' })
    const unchanged = withCurrentTimeOfDay(target, { localDate: null, timeInput: 'nope' })

    expect(fromLocalDate).toEqual(new Date(2026, 5, 6, 4, 5, 6))
    expect(fromInput).toEqual(new Date(2026, 5, 6, 7, 8, 9))
    expect(unchanged).toBe(target)
  })
})
