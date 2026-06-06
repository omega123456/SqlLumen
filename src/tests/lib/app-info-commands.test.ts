import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ipc } from '../ipc-mock'
import { getAppInfo } from '../../lib/app-info-commands'

const mockGetAppInfoFn = vi.fn(() => ({
  rustLogOverride: false,
  appVersion: '1.2.3',
}))

beforeEach(() => {
  mockGetAppInfoFn.mockClear()
  ipc.override('get_app_info', () => mockGetAppInfoFn())
})

describe('getAppInfo', () => {
  it('calls invoke with get_app_info and returns typed result', async () => {
    const result = await getAppInfo()

    expect(result).toEqual({
      rustLogOverride: false,
      appVersion: '1.2.3',
    })
    expect(ipc.calls('get_app_info')).toEqual([{}])
  })

  it('returns AppInfo with rustLogOverride true', async () => {
    mockGetAppInfoFn.mockReturnValue({
      rustLogOverride: true,
      appVersion: '0.1.0',
    })

    const result = await getAppInfo()

    expect(result.rustLogOverride).toBe(true)
    expect(result.appVersion).toBe('0.1.0')
  })
})
