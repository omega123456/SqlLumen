import { SETTINGS_DEFAULTS, useSettingsStore } from '../stores/settings-store'
import { MILLISECONDS_PER_MINUTE, MILLISECONDS_PER_SECOND } from './units'
import { isPositiveFiniteNumber } from './value-checks'

const FALLBACK_CACHE_TTL_MINUTES = 30

const DEFAULT_CACHE_TTL_SECONDS = Number.parseInt(SETTINGS_DEFAULTS['results.cacheTTL'] ?? '', 10)

export const DEFAULT_FRONTEND_CACHE_TTL_MS = isPositiveFiniteNumber(DEFAULT_CACHE_TTL_SECONDS)
  ? DEFAULT_CACHE_TTL_SECONDS * MILLISECONDS_PER_SECOND
  : FALLBACK_CACHE_TTL_MINUTES * MILLISECONDS_PER_MINUTE

export interface FrontendCacheTimerApi {
  setTimeout: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  clearTimeout: (timerId: ReturnType<typeof setTimeout>) => void
}

type InactiveTimerEntry = {
  timerId: ReturnType<typeof setTimeout>
}

function normalizeTtlMs(ttlSeconds: string | null | undefined): number {
  const parsedSeconds = Number.parseInt(ttlSeconds ?? '', 10)
  if (!isPositiveFiniteNumber(parsedSeconds)) {
    return DEFAULT_FRONTEND_CACHE_TTL_MS
  }
  return parsedSeconds * MILLISECONDS_PER_SECOND
}

export function getEffectiveFrontendCacheTtlMs(): number {
  const settings = useSettingsStore.getState()
  return normalizeTtlMs(settings.getEffectiveSetting('results.cacheTTL'))
}

export class FrontendCacheLifecycle {
  private readonly timerApi: FrontendCacheTimerApi

  private readonly inactiveTimers = new Map<string, InactiveTimerEntry>()

  constructor(timerApi: FrontendCacheTimerApi = globalThis) {
    this.timerApi = timerApi
  }

  getInactiveTimerCount(): number {
    return this.inactiveTimers.size
  }

  hasInactiveTimer(surfaceKey: string): boolean {
    return this.inactiveTimers.has(surfaceKey)
  }

  scheduleInactive(
    surfaceKey: string,
    onExpire: () => void,
    ttlMs = getEffectiveFrontendCacheTtlMs()
  ): void {
    this.cancel(surfaceKey)

    const timerId = this.timerApi.setTimeout(() => {
      this.inactiveTimers.delete(surfaceKey)
      onExpire()
    }, ttlMs)

    this.inactiveTimers.set(surfaceKey, { timerId })
  }

  cancel(surfaceKey: string): void {
    const existing = this.inactiveTimers.get(surfaceKey)
    if (!existing) return

    this.timerApi.clearTimeout(existing.timerId)
    this.inactiveTimers.delete(surfaceKey)
  }

  cleanup(surfaceKeys?: Iterable<string>): void {
    if (surfaceKeys) {
      for (const surfaceKey of surfaceKeys) {
        this.cancel(surfaceKey)
      }
      return
    }

    for (const surfaceKey of this.inactiveTimers.keys()) {
      this.cancel(surfaceKey)
    }
  }
}

export const frontendCacheLifecycle = new FrontendCacheLifecycle()

export function parseFrontendCacheTtlMs(ttlSeconds: string | null | undefined): number {
  return normalizeTtlMs(ttlSeconds)
}
