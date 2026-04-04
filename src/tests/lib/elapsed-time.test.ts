import { describe, it, expect } from 'vitest'
import { formatElapsedTime } from '../../lib/elapsed-time'

describe('formatElapsedTime', () => {
  it('returns "0s" for 0ms', () => expect(formatElapsedTime(0)).toBe('0s'))
  it('returns "0s" for negative values', () => expect(formatElapsedTime(-100)).toBe('0s'))
  it('returns "3s" for 3000ms', () => expect(formatElapsedTime(3000)).toBe('3s'))
  it('returns "59s" for 59000ms', () => expect(formatElapsedTime(59000)).toBe('59s'))
  it('returns "1m 0s" for 60000ms', () => expect(formatElapsedTime(60000)).toBe('1m 0s'))
  it('returns "1m 23s" for 83000ms', () => expect(formatElapsedTime(83000)).toBe('1m 23s'))
  it('returns "59m 59s" for 3599000ms', () => expect(formatElapsedTime(3599000)).toBe('59m 59s'))
  it('returns "1h 0m 0s" for 3600000ms', () => expect(formatElapsedTime(3600000)).toBe('1h 0m 0s'))
  it('returns "1h 2m 3s" for 3723000ms', () => expect(formatElapsedTime(3723000)).toBe('1h 2m 3s'))
})
