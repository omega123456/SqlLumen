import { afterEach, describe, expect, it, vi } from 'vitest'

async function loadModule() {
  vi.resetModules()
  return import('../../lib/processlist-time')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('processlist-time', () => {
  it('uses a fixed local noon timestamp for Playwright runs', async () => {
    vi.stubEnv('VITE_PLAYWRIGHT', 'true')

    const { formatProcessListRefreshTime, getProcessListRefreshTimestamp } = await loadModule()

    const fixedTimestamp = getProcessListRefreshTimestamp()
    expect(fixedTimestamp).toBe(new Date(2025, 0, 1, 12, 0, 0).getTime())
    expect(formatProcessListRefreshTime(fixedTimestamp)).toBe('12:00:00')
  })

  it('uses the current clock outside Playwright runs', async () => {
    vi.stubEnv('VITE_PLAYWRIGHT', 'false')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-03T04:05:06.000Z'))

    const { getProcessListRefreshTimestamp } = await loadModule()

    expect(getProcessListRefreshTimestamp()).toBe(Date.parse('2026-02-03T04:05:06.000Z'))
  })

  it('formats refresh times as local HH:mm:ss', async () => {
    vi.stubEnv('VITE_PLAYWRIGHT', 'false')

    const { formatProcessListRefreshTime } = await loadModule()

    expect(formatProcessListRefreshTime(new Date(2025, 0, 1, 7, 8, 9).getTime())).toBe('07:08:09')
    expect(formatProcessListRefreshTime(new Date(2025, 0, 1, 23, 59, 0).getTime())).toBe('23:59:00')
  })
})
