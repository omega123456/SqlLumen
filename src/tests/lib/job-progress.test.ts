import { describe, expect, it } from 'vitest'
import { isCancelInFlight, isTerminalJobStatus, progressPercent } from '../../lib/job-progress'

describe('isTerminalJobStatus', () => {
  it('treats completed, failed and cancelled as terminal', () => {
    expect(isTerminalJobStatus('completed')).toBe(true)
    expect(isTerminalJobStatus('failed')).toBe(true)
    expect(isTerminalJobStatus('cancelled')).toBe(true)
  })
})

describe('progressPercent', () => {
  it('treats a missing done count as zero', () => {
    expect(progressPercent(null, 10)).toBe(0)
  })
})

describe('isCancelInFlight', () => {
  it('is true while a cancel request is pending locally', () => {
    expect(isCancelInFlight(true, null)).toBe(true)
  })
})
