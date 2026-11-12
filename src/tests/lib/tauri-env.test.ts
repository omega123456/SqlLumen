import { afterEach, describe, expect, it, vi } from 'vitest'

import { hasTauriApis, isPlaywrightBuild } from '../../lib/tauri-env'

describe('tauri-env', () => {
  it('returns false when Tauri internals are missing', () => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__

    expect(hasTauriApis()).toBe(false)
  })

  it('returns true when Tauri internals are present', () => {
    ;(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}

    expect(hasTauriApis()).toBe(true)

    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
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

  it('is false otherwise', () => {
    vi.stubEnv('VITE_PLAYWRIGHT', 'false')

    expect(isPlaywrightBuild()).toBe(false)
  })
})
