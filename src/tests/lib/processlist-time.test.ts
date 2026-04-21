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
  it('uses a fixed UTC timestamp for Playwright runs', async () => {
    vi.stubEnv('VITE_PLAYWRIGHT', 'true')

    const { formatProcessListRefreshTime, getProcessListRefreshTimestamp } = await loadModule()

    expect(getProcessListRefreshTimestamp()).toBe(Date.parse('2025-01-01T12:00:00.000Z'))
    expect(formatProcessListRefreshTime(Date.parse('2025-01-01T12:00:00.000Z'))).toBe('12:00:00')
  })

  it('uses the current clock outside Playwright runs', async () => {
    vi.stubEnv('VITE_PLAYWRIGHT', 'false')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-03T04:05:06.000Z'))

    const { getProcessListRefreshTimestamp } = await loadModule()

    expect(getProcessListRefreshTimestamp()).toBe(Date.parse('2026-02-03T04:05:06.000Z'))
  })

  it('formats non-Playwright refresh times as an HH:mm:ss-style time', async () => {
    vi.stubEnv('VITE_PLAYWRIGHT', 'false')

    const { formatProcessListRefreshTime } = await loadModule()
    const formatted = formatProcessListRefreshTime(Date.parse('2025-01-01T12:00:00.000Z'))

    expect(formatted).toMatch(/^\d{2}:\d{2}:\d{2}$/)
  })
})
