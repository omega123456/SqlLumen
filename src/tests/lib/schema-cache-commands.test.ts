import { describe, it, expect } from 'vitest'

import { ipc } from '../ipc-mock'
import { loadSchemaCacheSnapshot, saveSchemaCacheSnapshot } from '../../lib/schema-cache-commands'

describe('schema-cache-commands', () => {
  it('loads and saves a schema cache snapshot for a connection', async () => {
    ipc.override('load_schema_cache_snapshot', () => '{"tables":[]}')

    await expect(loadSchemaCacheSnapshot('conn-1')).resolves.toBe('{"tables":[]}')
    expect(ipc.calls('load_schema_cache_snapshot')).toEqual([{ connectionId: 'conn-1' }])

    await expect(saveSchemaCacheSnapshot('conn-1', '{"tables":["users"]}')).resolves.toBeUndefined()
    expect(ipc.payloads('save_schema_cache_snapshot')).toEqual([
      {
        connectionId: 'conn-1',
        snapshotJson: '{"tables":["users"]}',
      },
    ])
  })
})
