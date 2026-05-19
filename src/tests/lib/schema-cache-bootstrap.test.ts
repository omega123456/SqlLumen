import { beforeEach, describe, expect, it } from 'vitest'
import { waitFor } from '@testing-library/react'

import { ipc } from '../ipc-mock'
import { _clearAllCaches, getCache } from '../../components/query-editor/schema-metadata-cache'

const EMPTY_SCHEMA_OBJECTS = {
  tables: {},
  columns: {},
  routines: {},
  foreignKeys: {},
  indexes: {},
}

function buildSchemaMetadata(databases: string[]) {
  return {
    databases,
    ...EMPTY_SCHEMA_OBJECTS,
  }
}

function buildSnapshotJson(databases: string[]): string {
  return JSON.stringify(buildSchemaMetadata(databases))
}

describe('bootstrapSchemaCache', () => {
  beforeEach(() => {
    _clearAllCaches()
    ipc.override('load_schema_cache_snapshot', () => null)
    ipc.override('save_schema_cache_snapshot', () => undefined)
    ipc.override('fetch_schema_metadata_full', () => buildSchemaMetadata(['fresh']))
  })

  it('exposes a pending bootstrap promise while in-flight', async () => {
    const { bootstrapSchemaCache, getPendingBootstrap, _clearPendingBootstraps } =
      await import('../../lib/schema-cache-bootstrap')
    _clearPendingBootstraps()

    expect(getPendingBootstrap('session-1')).toBeNull()

    let resolveLoad!: () => void
    ipc.override(
      'load_schema_cache_snapshot',
      () =>
        new Promise<string | null>((resolve) => {
          resolveLoad = () => resolve(null)
        })
    )

    const bootstrapPromise = bootstrapSchemaCache('session-1')
    expect(getPendingBootstrap('session-1')).not.toBeNull()

    resolveLoad()
    await bootstrapPromise

    expect(getPendingBootstrap('session-1')).toBeNull()
  })

  it('hydrates from a persisted snapshot and uses background refresh (not rebuild)', async () => {
    const { bootstrapSchemaCache, getPendingBootstrap } =
      await import('../../lib/schema-cache-bootstrap')
    ipc.override('load_schema_cache_snapshot', () => buildSnapshotJson(['cached']))
    let resolveRefresh!: () => void
    ipc.override(
      'fetch_schema_metadata_full',
      () =>
        new Promise((resolve) => {
          resolveRefresh = () => resolve(buildSchemaMetadata(['fresh']))
        })
    )

    const bootstrapPromise = bootstrapSchemaCache('session-1')

    await waitFor(() => {
      expect(getCache('session-1').databases).toEqual(['cached'])
      expect(getPendingBootstrap('session-1')).toBeNull()
    })

    expect(ipc.calls('save_schema_cache_snapshot')).toHaveLength(0)

    resolveRefresh()
    await bootstrapPromise

    expect(ipc.calls('load_schema_cache_snapshot')).toContainEqual({ connectionId: 'session-1' })
    expect(ipc.calls('fetch_schema_metadata_full')).toContainEqual({ connectionId: 'session-1' })
    expect(getCache('session-1').databases).toEqual(['fresh'])
    expect(ipc.calls('save_schema_cache_snapshot')).toContainEqual({
      connectionId: 'session-1',
      snapshotJson: buildSnapshotJson(['fresh']),
    })
  })

  it('uses full rebuild when no persisted snapshot exists', async () => {
    const { bootstrapSchemaCache, getPendingBootstrap } =
      await import('../../lib/schema-cache-bootstrap')
    let resolveRebuild!: () => void
    ipc.override(
      'fetch_schema_metadata_full',
      () =>
        new Promise((resolve) => {
          resolveRebuild = () => resolve(buildSchemaMetadata(['fresh']))
        })
    )

    const bootstrapPromise = bootstrapSchemaCache('session-1')

    await waitFor(() => {
      expect(getPendingBootstrap('session-1')).not.toBeNull()
      expect(getCache('session-1').status).toBe('loading')
    })

    expect(ipc.calls('save_schema_cache_snapshot')).toHaveLength(0)

    resolveRebuild()
    await bootstrapPromise

    expect(ipc.calls('load_schema_cache_snapshot')).toContainEqual({ connectionId: 'session-1' })
    expect(ipc.calls('fetch_schema_metadata_full')).toContainEqual({ connectionId: 'session-1' })
    expect(getCache('session-1').databases).toEqual(['fresh'])
    expect(getPendingBootstrap('session-1')).toBeNull()
    expect(ipc.calls('save_schema_cache_snapshot')).toContainEqual({
      connectionId: 'session-1',
      snapshotJson: buildSnapshotJson(['fresh']),
    })
  })

  it('logs load failures and falls back to full rebuild', async () => {
    const { bootstrapSchemaCache } = await import('../../lib/schema-cache-bootstrap')
    ipc.override('load_schema_cache_snapshot', () => {
      throw new Error('load failed')
    })

    await bootstrapSchemaCache('session-1')

    expect(ipc.calls('log_frontend')).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        message: expect.stringContaining('Failed to load persisted schema cache'),
      })
    )
    expect(getCache('session-1').databases).toEqual(['fresh'])
  })

  it('logs background refresh failures without throwing', async () => {
    const { bootstrapSchemaCache } = await import('../../lib/schema-cache-bootstrap')
    ipc.override('load_schema_cache_snapshot', () => buildSnapshotJson(['cached']))
    ipc.override('fetch_schema_metadata_full', () => {
      throw new Error('refresh failed')
    })

    await expect(bootstrapSchemaCache('session-1')).resolves.toBeUndefined()

    expect(getCache('session-1').databases).toEqual(['cached'])
    expect(ipc.calls('save_schema_cache_snapshot')).toHaveLength(0)
    await waitFor(() => {
      expect(ipc.calls('log_frontend')).toContainEqual(
        expect.objectContaining({
          level: 'warn',
          message: expect.stringContaining('Failed to rebuild persisted schema cache'),
        })
      )
    })
  })

  it('keeps rebuild fetch failures in the real cache error state without throwing', async () => {
    const { bootstrapSchemaCache, getPendingBootstrap } =
      await import('../../lib/schema-cache-bootstrap')
    ipc.override('fetch_schema_metadata_full', () => {
      throw new Error('rebuild failed')
    })

    await expect(bootstrapSchemaCache('session-1')).resolves.toBeUndefined()

    expect(ipc.calls('load_schema_cache_snapshot')).toContainEqual({ connectionId: 'session-1' })
    expect(ipc.calls('fetch_schema_metadata_full')).toContainEqual({ connectionId: 'session-1' })
    expect(ipc.calls('save_schema_cache_snapshot')).toHaveLength(0)
    expect(getPendingBootstrap('session-1')).toBeNull()
    expect(getCache('session-1')).toMatchObject({
      status: 'error',
      error: 'rebuild failed',
      databases: [],
    })
    expect(ipc.calls('log_frontend')).toHaveLength(0)
  })
})
