import { describe, it, expect, beforeEach } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
import {
  buildSchemaIndex,
  semanticSearch,
  getIndexStatus,
  invalidateSchemaIndex,
  listIndexedTables,
} from '../../lib/schema-index-commands'

let lastInvokedCmd: string | null = null
let lastInvokedArgs: Record<string, unknown> | null = null

beforeEach(() => {
  lastInvokedCmd = null
  lastInvokedArgs = null

  mockIPC((cmd, args) => {
    lastInvokedCmd = cmd
    lastInvokedArgs = args as Record<string, unknown>

    switch (cmd) {
      case 'build_schema_index':
        return undefined
      case 'semantic_search':
        return [
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
        ]
      case 'get_index_status':
        return { status: 'ready' }
      case 'invalidate_schema_index':
        return undefined
      case 'list_indexed_tables':
        return [
          {
            dbName: 'testdb',
            tableName: 'users',
            chunkType: 'table',
            embeddedAt: '2025-01-01T00:00:00Z',
            modelId: 'text-embedding-3-small',
          },
        ]
      case 'log_frontend':
        return undefined
      case 'plugin:event|listen':
        return () => {}
      case 'plugin:event|unlisten':
        return undefined
      default:
        throw new Error(`[vitest] Unmocked Tauri IPC command: ${cmd}`)
    }
  })
})

describe('schema-index-commands', () => {
  describe('buildSchemaIndex', () => {
    it('invokes build_schema_index with correct sessionId', async () => {
      await buildSchemaIndex('session-123')
      expect(lastInvokedCmd).toBe('build_schema_index')
      expect(lastInvokedArgs?.sessionId).toBe('session-123')
    })
  })

  describe('semanticSearch', () => {
    it('invokes semantic_search with correct args and returns results', async () => {
      const results = await semanticSearch('session-1', ['query1', 'query2'])
      expect(lastInvokedCmd).toBe('semantic_search')
      expect(lastInvokedArgs?.sessionId).toBe('session-1')
      expect(lastInvokedArgs?.queries).toEqual(['query1', 'query2'])
      expect(results).toHaveLength(1)
      expect(results[0].chunkKey).toBe('db.users:table')
      expect(results[0].score).toBe(0.95)
    })
  })

  describe('getIndexStatus', () => {
    it('invokes get_index_status with correct args and returns status', async () => {
      const status = await getIndexStatus('session-1')
      expect(lastInvokedCmd).toBe('get_index_status')
      expect(lastInvokedArgs?.sessionId).toBe('session-1')
      expect(status.status).toBe('ready')
    })
  })

  describe('invalidateSchemaIndex', () => {
    it('invokes invalidate_schema_index with correct args', async () => {
      await invalidateSchemaIndex('session-1', ['db.users', 'db.orders'])
      expect(lastInvokedCmd).toBe('invalidate_schema_index')
      expect(lastInvokedArgs?.sessionId).toBe('session-1')
      expect(lastInvokedArgs?.tables).toEqual(['db.users', 'db.orders'])
    })
  })

  describe('listIndexedTables', () => {
    it('invokes list_indexed_tables with correct args and returns table list', async () => {
      const tables = await listIndexedTables('session-1')
      expect(lastInvokedCmd).toBe('list_indexed_tables')
      expect(lastInvokedArgs?.sessionId).toBe('session-1')
      expect(tables).toHaveLength(1)
      expect(tables[0].dbName).toBe('testdb')
      expect(tables[0].tableName).toBe('users')
      expect(tables[0].modelId).toBe('text-embedding-3-small')
    })
  })
})
