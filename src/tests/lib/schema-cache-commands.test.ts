import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockInvoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

import {
  loadSchemaCacheSnapshot,
  saveSchemaCacheSnapshot,
} from '../../lib/schema-cache-commands'

describe('schema-cache-commands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads a schema cache snapshot for a connection', async () => {
    mockInvoke.mockResolvedValueOnce('{"tables":[]}')

    await expect(loadSchemaCacheSnapshot('conn-1')).resolves.toBe('{"tables":[]}')
    expect(mockInvoke).toHaveBeenCalledWith('load_schema_cache_snapshot', {
      connectionId: 'conn-1',
    })
  })

  it('saves a schema cache snapshot for a connection', async () => {
    mockInvoke.mockResolvedValueOnce(undefined)

    await expect(saveSchemaCacheSnapshot('conn-1', '{"tables":["users"]}')).resolves.toBeUndefined()
    expect(mockInvoke).toHaveBeenCalledWith('save_schema_cache_snapshot', {
      connectionId: 'conn-1',
      snapshotJson: '{"tables":["users"]}',
    })
  })
})
