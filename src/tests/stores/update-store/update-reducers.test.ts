import { describe, expect, it } from 'vitest'
import {
  clearUpToDateStatus,
  failInstall,
  failRestart,
  withDetectedPlatform,
} from '../../../stores/update-store/update-reducers'
import { getPlatformState } from '../../../stores/update-store/update-platform'

describe('update reducers', () => {
  it('keeps the available version when the platform is detected', () => {
    expect(withDetectedPlatform({ availableVersion: '2.0.0' }, 'windows')).toEqual(
      getPlatformState('windows', '2.0.0')
    )
  })

  it('returns an up-to-date status to idle and leaves any other status alone', () => {
    const upToDate = {
      status: 'up-to-date' as const,
      currentPlatform: 'macos' as const,
      availableVersion: null,
    }
    expect(clearUpToDateStatus(upToDate)).toMatchObject({ status: 'idle', errorMessage: null })
    const checking = { ...upToDate, status: 'checking' as const }
    expect(clearUpToDateStatus(checking)).toBe(checking)
  })

  it('records an install failure', () => {
    const failed = failInstall({ currentPlatform: 'linux', availableVersion: '2.0.0' }, 'boom')
    expect(failed).toMatchObject({
      status: 'error',
      errorMessage: 'boom',
      updateObject: null,
      readyToFinishAction: 'manual-quit',
    })
  })

  it('keeps a pending finish when the restart fails', () => {
    const platform = { currentPlatform: 'macos' as const, availableVersion: '2.0.0' }
    expect(failRestart({ ...platform, status: 'ready-to-finish' }, 'boom').status).toBe(
      'ready-to-finish'
    )
    expect(failRestart({ ...platform, status: 'idle' }, 'boom').status).toBe('error')
  })
})
