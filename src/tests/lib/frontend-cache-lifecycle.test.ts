import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_FRONTEND_CACHE_TTL_MS,
  FrontendCacheLifecycle,
  getEffectiveFrontendCacheTtlMs,
  parseFrontendCacheTtlMs,
} from '../../lib/frontend-cache-lifecycle'
import { useSettingsStore } from '../../stores/settings-store'

describe('frontend-cache-lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useSettingsStore.setState({
      settings: {},
      pendingChanges: {},
      isLoading: false,
      isDirty: false,
      activeSection: 'general',
      isDialogOpen: false,
      dialogSection: undefined,
    })
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('uses the default TTL when no settings value is present', () => {
    expect(getEffectiveFrontendCacheTtlMs()).toBe(DEFAULT_FRONTEND_CACHE_TTL_MS)
  })

  it('falls back to the default TTL for invalid values', () => {
    expect(parseFrontendCacheTtlMs('0')).toBe(DEFAULT_FRONTEND_CACHE_TTL_MS)
    expect(parseFrontendCacheTtlMs('-1')).toBe(DEFAULT_FRONTEND_CACHE_TTL_MS)
    expect(parseFrontendCacheTtlMs('not-a-number')).toBe(DEFAULT_FRONTEND_CACHE_TTL_MS)
  })

  it('cleans up registered timers without invoking callbacks', async () => {
    const lifecycle = new FrontendCacheLifecycle()
    const onExpireA = vi.fn()
    const onExpireB = vi.fn()

    lifecycle.scheduleInactive('query:tab-1:result-0', onExpireA, 1000)
    lifecycle.scheduleInactive('table:tab-2', onExpireB, 1000)

    lifecycle.cleanup(['query:tab-1:result-0', 'table:tab-2'])

    await vi.advanceTimersByTimeAsync(1000)

    expect(onExpireA).not.toHaveBeenCalled()
    expect(onExpireB).not.toHaveBeenCalled()
    expect(lifecycle.getInactiveTimerCount()).toBe(0)
  })
})
