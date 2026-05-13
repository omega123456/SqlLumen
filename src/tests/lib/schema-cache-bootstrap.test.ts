import { beforeEach, describe, expect, it, vi } from 'vitest'

const loadSchemaCacheSnapshot = vi.fn<() => Promise<string | null>>()
const saveSchemaCacheSnapshot = vi.fn<() => Promise<void>>()
const hydrateFromSnapshot = vi.fn<() => void>()
const rebuildCache = vi.fn<() => Promise<void>>()
const serializeCacheSnapshot = vi.fn<() => string | null>()
const logFrontend = vi.fn<() => Promise<void>>()

vi.mock('../../lib/schema-cache-commands', () => ({
  loadSchemaCacheSnapshot,
  saveSchemaCacheSnapshot,
}))

vi.mock('../../components/query-editor/schema-metadata-cache', () => ({
  hydrateFromSnapshot,
  rebuildCache,
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
    serializeCacheSnapshot.mockReturnValue('{"databases":["fresh"]}')
    logFrontend.mockResolvedValue(undefined)
  })

  it('hydrates from a persisted snapshot before rebuilding and saving fresh cache', async () => {
    const { bootstrapSchemaCache } = await import('../../lib/schema-cache-bootstrap')
    loadSchemaCacheSnapshot.mockResolvedValue('{"databases":["cached"]}')

    await bootstrapSchemaCache('session-1')

    expect(loadSchemaCacheSnapshot).toHaveBeenCalledWith('session-1')
    expect(hydrateFromSnapshot).toHaveBeenCalledWith('{"databases":["cached"]}', 'session-1')
    expect(rebuildCache).toHaveBeenCalledWith('session-1')
    expect(serializeCacheSnapshot).toHaveBeenCalledWith('session-1')
    expect(saveSchemaCacheSnapshot).toHaveBeenCalledWith('session-1', '{"databases":["fresh"]}')
  })

  it('still rebuilds and saves when no persisted snapshot exists', async () => {
    const { bootstrapSchemaCache } = await import('../../lib/schema-cache-bootstrap')

    await bootstrapSchemaCache('session-1')

    expect(hydrateFromSnapshot).not.toHaveBeenCalled()
    expect(rebuildCache).toHaveBeenCalledWith('session-1')
    expect(saveSchemaCacheSnapshot).toHaveBeenCalledWith('session-1', '{"databases":["fresh"]}')
  })

  it('logs load failures without blocking fresh rebuild persistence', async () => {
    const { bootstrapSchemaCache } = await import('../../lib/schema-cache-bootstrap')
    loadSchemaCacheSnapshot.mockRejectedValue(new Error('load failed'))

    await bootstrapSchemaCache('session-1')

    expect(logFrontend).toHaveBeenCalledWith(
      'warn',
      expect.stringContaining('Failed to load persisted schema cache')
    )
    expect(rebuildCache).toHaveBeenCalledWith('session-1')
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
})
