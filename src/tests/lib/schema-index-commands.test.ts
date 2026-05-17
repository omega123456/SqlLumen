import { describe, it, expect, beforeEach } from 'vitest'
import { ipc } from '../ipc-mock'
import {
  buildSchemaIndex,
  forceRebuildSchemaIndex,
  semanticSearch,
  getIndexStatus,
  invalidateSchemaIndex,
  listIndexedTables,
} from '../../lib/schema-index-commands'

beforeEach(() => {
  ipc.reset()
  ipc.override('build_schema_index', () => undefined)
  ipc.override('force_rebuild_schema_index', () => undefined)
  ipc.override('semantic_search', () => [
    {
      chunkId: 1,
      chunkKey: 'db.users:table',
      dbName: 'db',
      tableName: 'users',
      chunkType: 'table',
      ddlText: 'CREATE TABLE users (...)',
      refDbName: null,
      refTableName: null,
      score: 0.95,
    },
  ])
  ipc.override('get_index_status', () => ({ status: 'ready' }))
  ipc.override('invalidate_schema_index', () => undefined)
  ipc.override('list_indexed_tables', () => [
    {
      dbName: 'testdb',
      tableName: 'users',
      chunkType: 'table',
      embeddedAt: '2025-01-01T00:00:00Z',
      modelId: 'text-embedding-3-small',
    },
  ])
})

describe('schema-index-commands', () => {
  describe('buildSchemaIndex', () => {
    it('invokes build_schema_index with correct sessionId', async () => {
      await buildSchemaIndex('session-123')
      expect(ipc.calls('build_schema_index')).toEqual([{ sessionId: 'session-123' }])
    })
  })

  describe('forceRebuildSchemaIndex', () => {
    it('invokes force_rebuild_schema_index with correct sessionId', async () => {
      await forceRebuildSchemaIndex('session-123')
      expect(ipc.calls('force_rebuild_schema_index')).toEqual([{ sessionId: 'session-123' }])
    })
  })

  describe('semanticSearch', () => {
    it('invokes semantic_search with correct args and returns results', async () => {
      const results = await semanticSearch('session-1', ['query1', 'query2'])
      expect(ipc.calls('semantic_search')).toEqual([
        { sessionId: 'session-1', queries: ['query1', 'query2'], hints: null },
      ])
      expect(results).toHaveLength(1)
      expect(results[0].chunkKey).toBe('db.users:table')
      expect(results[0].score).toBe(0.95)
    })
  })

  describe('getIndexStatus', () => {
    it('invokes get_index_status with correct args and returns status', async () => {
      const status = await getIndexStatus('session-1')
      expect(ipc.calls('get_index_status')).toEqual([{ sessionId: 'session-1' }])
      expect(status.status).toBe('ready')
    })
  })

  describe('invalidateSchemaIndex', () => {
    it('invokes invalidate_schema_index with correct args', async () => {
      await invalidateSchemaIndex('session-1', ['db.users', 'db.orders'])
      expect(ipc.calls('invalidate_schema_index')).toEqual([
        { sessionId: 'session-1', tables: ['db.users', 'db.orders'] },
      ])
    })
  })

  describe('listIndexedTables', () => {
    it('invokes list_indexed_tables with correct args and returns table list', async () => {
      const tables = await listIndexedTables('session-1')
      expect(ipc.calls('list_indexed_tables')).toEqual([{ sessionId: 'session-1' }])
      expect(tables).toHaveLength(1)
      expect(tables[0].dbName).toBe('testdb')
      expect(tables[0].tableName).toBe('users')
      expect(tables[0].modelId).toBe('text-embedding-3-small')
    })
  })
})
