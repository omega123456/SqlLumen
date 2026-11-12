import { describe, expect, it } from 'vitest'
import { isTerminalJobStatus, progressPercent } from '../../lib/job-progress'

describe('isTerminalJobStatus', () => {
  it('treats completed, failed and cancelled as terminal', () => {
    expect(isTerminalJobStatus('completed')).toBe(true)
    expect(isTerminalJobStatus('failed')).toBe(true)
    expect(isTerminalJobStatus('cancelled')).toBe(true)
  })

  it('treats a running or unknown job as not terminal', () => {
    expect(isTerminalJobStatus('running')).toBe(false)
    expect(isTerminalJobStatus(undefined)).toBe(false)
  })
})

describe('progressPercent', () => {
  it('rounds the done share of the total to a percentage', () => {
    expect(progressPercent(1, 3)).toBe(33)
    expect(progressPercent(3, 3)).toBe(100)
  })

  it('returns zero when the total is missing or zero', () => {
    expect(progressPercent(5, 0)).toBe(0)
    expect(progressPercent(5, null)).toBe(0)
    expect(progressPercent(undefined, undefined)).toBe(0)
  })

  it('treats a missing done count as zero', () => {
    expect(progressPercent(null, 10)).toBe(0)
  })
})
