import { describe, it, expect } from 'vitest'
import { elapsedParts, formatElapsedTime, formatSpacedDuration } from '../../lib/elapsed-time'

describe('formatElapsedTime', () => {
  it('returns "0s" for 0ms', () => expect(formatElapsedTime(0)).toBe('0s'))
  it('returns "0s" for negative values', () => expect(formatElapsedTime(-100)).toBe('0s'))
  it('returns "1m 23s" for 83000ms', () => expect(formatElapsedTime(83000)).toBe('1m 23s'))
  it('returns "1h 2m 3s" for 3723000ms', () => expect(formatElapsedTime(3723000)).toBe('1h 2m 3s'))
  it('keeps counting hours past one day', () =>
    expect(formatElapsedTime(25 * 3600000 + 61000)).toBe('25h 1m 1s'))
})

describe('elapsedParts', () => {
  it('splits elapsed time into hours, minutes of the hour and seconds of the minute', () => {
    expect(elapsedParts(3723999)).toEqual({
      hours: 1,
      minutesOfHour: 2,
      totalMinutes: 62,
      secondsOfMinute: 3,
    })
  })

  it('clamps negative values to zero', () => {
    expect(elapsedParts(-1)).toEqual({
      hours: 0,
      minutesOfHour: 0,
      totalMinutes: 0,
      secondsOfMinute: 0,
    })
  })
})

describe('short durations', () => {
  it('shows milliseconds below one second', () => {
    expect(formatSpacedDuration(999)).toBe('999 ms')
  })

  it('shows one decimal of seconds from one second up', () => {
    expect(formatSpacedDuration(1250)).toBe('1.3 s')
  })
})
