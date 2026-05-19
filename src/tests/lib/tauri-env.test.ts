import { describe, expect, it } from 'vitest'

import { hasTauriApis } from '../../lib/tauri-env'

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
