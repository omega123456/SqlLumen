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
})
