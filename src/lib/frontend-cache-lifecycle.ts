import { SETTINGS_DEFAULTS, useSettingsStore } from '../stores/settings-store'

const DEFAULT_CACHE_TTL_SECONDS = Number.parseInt(SETTINGS_DEFAULTS['results.cacheTTL'] ?? '', 10)

export const DEFAULT_FRONTEND_CACHE_TTL_MS =
  Number.isFinite(DEFAULT_CACHE_TTL_SECONDS) && DEFAULT_CACHE_TTL_SECONDS > 0
    ? DEFAULT_CACHE_TTL_SECONDS * 1000
    : 30 * 60 * 1000

export interface FrontendCacheTimerApi {
  setTimeout: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  clearTimeout: (timerId: ReturnType<typeof setTimeout>) => void
}

type InactiveTimerEntry = {
  timerId: ReturnType<typeof setTimeout>
}

function normalizeTtlMs(ttlSeconds: string | null | undefined): number {
  const parsedSeconds = Number.parseInt(ttlSeconds ?? '', 10)
  if (!Number.isFinite(parsedSeconds) || parsedSeconds <= 0) {
    return DEFAULT_FRONTEND_CACHE_TTL_MS
  }
  return parsedSeconds * 1000
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
