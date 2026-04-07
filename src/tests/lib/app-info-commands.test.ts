import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
import { getAppInfo } from '../../lib/app-info-commands'

const mockGetAppInfoFn = vi.fn(() => ({
  rustLogOverride: false,
  logDirectory: '/app/logs',
  appVersion: '1.2.3',
}))

beforeEach(() => {
  mockGetAppInfoFn.mockClear()

  mockIPC((cmd) => {
    switch (cmd) {
      case 'get_app_info':
        return mockGetAppInfoFn()
      case 'log_frontend':
        return undefined
      default:
        return null
    }
  })
})

describe('getAppInfo', () => {
  it('calls invoke with get_app_info and returns typed result', async () => {
    const result = await getAppInfo()

    expect(result).toEqual({
      rustLogOverride: false,
      logDirectory: '/app/logs',
      appVersion: '1.2.3',
    })
    expect(mockGetAppInfoFn).toHaveBeenCalledTimes(1)
  })

  it('returns AppInfo with rustLogOverride true', async () => {
    mockGetAppInfoFn.mockReturnValue({
      rustLogOverride: true,
      logDirectory: '/other/logs',
      appVersion: '0.1.0',
    })

    const result = await getAppInfo()

    expect(result.rustLogOverride).toBe(true)
    expect(result.logDirectory).toBe('/other/logs')
    expect(result.appVersion).toBe('0.1.0')
  })
})
