import { beforeEach, describe, expect, it, vi } from 'vitest'

const loadSchemaCacheSnapshot = vi.fn<() => Promise<string | null>>()
const saveSchemaCacheSnapshot = vi.fn<() => Promise<void>>()
const hydrateFromSnapshot = vi.fn<() => void>()
const rebuildCache = vi.fn<() => Promise<void>>()
const refreshCacheInBackground = vi.fn<() => Promise<void>>()
const serializeCacheSnapshot = vi.fn<() => string | null>()
const logFrontend = vi.fn<() => Promise<void>>()

vi.mock('../../lib/schema-cache-commands', () => ({
  loadSchemaCacheSnapshot,
  saveSchemaCacheSnapshot,
}))

vi.mock('../../components/query-editor/schema-metadata-cache', () => ({
  hydrateFromSnapshot,
  rebuildCache,
  refreshCacheInBackground,
  serializeCacheSnapshot,
}))

vi.mock('../../lib/app-log-commands', () => ({
  logFrontend,
}))

describe('bootstrapSchemaCache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadSchemaCacheSnapshot.mockResolvedValue(null)
    saveSchemaCacheSnapshot.mockResolvedValue(undefined)
    rebuildCache.mockResolvedValue(undefined)
    refreshCacheInBackground.mockResolvedValue(undefined)
    serializeCacheSnapshot.mockReturnValue('{"databases":["fresh"]}')
    logFrontend.mockResolvedValue(undefined)
  })

  it('exposes a pending bootstrap promise while in-flight', async () => {
    const { bootstrapSchemaCache, getPendingBootstrap, _clearPendingBootstraps } =
      await import('../../lib/schema-cache-bootstrap')
    _clearPendingBootstraps()

    // Before starting: no pending bootstrap
    expect(getPendingBootstrap('session-1')).toBeNull()

    let resolveLoad!: () => void
    loadSchemaCacheSnapshot.mockReturnValue(
      new Promise<string | null>((resolve) => {
        resolveLoad = () => resolve(null)
      })
    )

    const bootstrapPromise = bootstrapSchemaCache('session-1')

    // While in-flight: pending bootstrap exists
    expect(getPendingBootstrap('session-1')).not.toBeNull()

    resolveLoad()
    await bootstrapPromise

    // After completion: pending bootstrap is cleared
    expect(getPendingBootstrap('session-1')).toBeNull()
  })

  it('hydrates from a persisted snapshot and uses background refresh (not rebuild)', async () => {
    const { bootstrapSchemaCache } = await import('../../lib/schema-cache-bootstrap')
    loadSchemaCacheSnapshot.mockResolvedValue('{"databases":["cached"]}')

    await bootstrapSchemaCache('session-1')

    expect(loadSchemaCacheSnapshot).toHaveBeenCalledWith('session-1')
    expect(hydrateFromSnapshot).toHaveBeenCalledWith('{"databases":["cached"]}', 'session-1')
    // Should use background refresh (non-invalidating) when snapshot exists
    expect(refreshCacheInBackground).toHaveBeenCalledWith('session-1')
    expect(rebuildCache).not.toHaveBeenCalled()
    expect(serializeCacheSnapshot).toHaveBeenCalledWith('session-1')
    expect(saveSchemaCacheSnapshot).toHaveBeenCalledWith('session-1', '{"databases":["fresh"]}')
  })

  it('uses full rebuild when no persisted snapshot exists', async () => {
    const { bootstrapSchemaCache } = await import('../../lib/schema-cache-bootstrap')

    await bootstrapSchemaCache('session-1')

    expect(hydrateFromSnapshot).not.toHaveBeenCalled()
    // Should use full rebuild when no cached snapshot to serve
    expect(rebuildCache).toHaveBeenCalledWith('session-1')
    expect(refreshCacheInBackground).not.toHaveBeenCalled()
    expect(saveSchemaCacheSnapshot).toHaveBeenCalledWith('session-1', '{"databases":["fresh"]}')
  })

  it('logs load failures and falls back to full rebuild', async () => {
    const { bootstrapSchemaCache } = await import('../../lib/schema-cache-bootstrap')
    loadSchemaCacheSnapshot.mockRejectedValue(new Error('load failed'))

    await bootstrapSchemaCache('session-1')

    expect(logFrontend).toHaveBeenCalledWith(
      'warn',
      expect.stringContaining('Failed to load persisted schema cache')
    )
    // Should fall back to rebuild since hydration failed
    expect(rebuildCache).toHaveBeenCalledWith('session-1')
    expect(refreshCacheInBackground).not.toHaveBeenCalled()
    expect(saveSchemaCacheSnapshot).toHaveBeenCalledWith('session-1', '{"databases":["fresh"]}')
  })

  it('logs rebuild failures without throwing', async () => {
    const { bootstrapSchemaCache } = await import('../../lib/schema-cache-bootstrap')
    rebuildCache.mockRejectedValue(new Error('rebuild failed'))

    await expect(bootstrapSchemaCache('session-1')).resolves.toBeUndefined()

    expect(saveSchemaCacheSnapshot).not.toHaveBeenCalled()
    expect(logFrontend).toHaveBeenCalledWith(
      'warn',
      expect.stringContaining('Failed to rebuild persisted schema cache')
    )
  })

  it('logs background refresh failures without throwing', async () => {
    const { bootstrapSchemaCache } = await import('../../lib/schema-cache-bootstrap')
    loadSchemaCacheSnapshot.mockResolvedValue('{"databases":["cached"]}')
    refreshCacheInBackground.mockRejectedValue(new Error('refresh failed'))

    await expect(bootstrapSchemaCache('session-1')).resolves.toBeUndefined()

    expect(hydrateFromSnapshot).toHaveBeenCalledWith('{"databases":["cached"]}', 'session-1')
    expect(saveSchemaCacheSnapshot).not.toHaveBeenCalled()
    expect(logFrontend).toHaveBeenCalledWith(
      'warn',
      expect.stringContaining('Failed to rebuild persisted schema cache')
    )
  })
})
