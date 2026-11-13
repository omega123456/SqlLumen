import { describe, expect, it } from 'vitest'
import { getPlatformState } from '../../../stores/update-store/update-platform'

describe('getPlatformState', () => {
  it('asks Linux users to quit and reopen manually', () => {
    expect(getPlatformState('linux', '2.0.0')).toEqual({
      currentPlatform: 'linux',
      readyToFinishAction: 'manual-quit',
      readyToFinishCta: 'Got it',
      readyToFinishMessage: 'Quit and reopen SqlLumen to finish installing version 2.0.0.',
    })
  })

  it('offers a relaunch elsewhere and names the latest version when unknown', () => {
    expect(getPlatformState('macos', null)).toEqual({
      currentPlatform: 'macos',
      readyToFinishAction: 'relaunch',
      readyToFinishCta: 'Restart app',
      readyToFinishMessage: 'Restart SqlLumen to finish installing version the latest version.',
    })
  })
})
