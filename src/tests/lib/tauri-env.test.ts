import { afterEach, describe, expect, it, vi } from 'vitest'

import { hasTauriApis, hasWindow, isPlaywrightBuild } from '../../lib/tauri-env'

describe('hasWindow', () => {
  it('is true in the browser environment', () => {
    expect(hasWindow()).toBe(true)
  })
})

describe('tauri-env', () => {
  it('returns false when Tauri internals are missing', () => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__

    expect(hasTauriApis()).toBe(false)
  })
})

describe('isPlaywrightBuild', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is true when the Playwright build flag is set', () => {
    vi.stubEnv('VITE_PLAYWRIGHT', 'true')

    expect(isPlaywrightBuild()).toBe(true)
  })
})
