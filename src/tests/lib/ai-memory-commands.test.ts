import { describe, it, expect, beforeEach } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
import {
  saveMemory,
  listMemories,
  deleteMemory,
  searchMemories,
  reembedMemories,
} from '../../lib/ai-memory-commands'

let lastInvokedCmd: string | null = null
let lastInvokedArgs: Record<string, unknown> | null = null

beforeEach(() => {
  lastInvokedCmd = null
  lastInvokedArgs = null

  mockIPC((cmd, args) => {
    lastInvokedCmd = cmd
    lastInvokedArgs = args as Record<string, unknown>

    switch (cmd) {
      case 'save_memory':
        return {
          id: 1,
          connectionId: 'conn-1',
          content: (args as Record<string, unknown>)?.content ?? '',
          createdAt: 1700000000,
          source: 'manual',
        }
      case 'list_memories':
        return [
          {
            id: 1,
            connectionId: 'conn-1',
            content: 'test memory',
            createdAt: 1700000000,
            source: 'manual',
          },
        ]
      case 'delete_memory':
        return undefined
      case 'search_memories':
        return [
          {
            id: 2,
            connectionId: 'conn-1',
            content: 'search result',
            createdAt: 1700000000,
            source: 'manual',
          },
        ]
      case 'reembed_memories':
        return undefined
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

describe('ai-memory-commands', () => {
  describe('saveMemory', () => {
    it('invokes save_memory with correct args', async () => {
      const result = await saveMemory({ sessionId: 'session-1', content: 'hello world' })
      expect(lastInvokedCmd).toBe('save_memory')
      expect(lastInvokedArgs?.sessionId).toBe('session-1')
      expect(lastInvokedArgs?.content).toBe('hello world')
      expect(result.id).toBe(1)
      expect(result.source).toBe('manual')
    })
  })

  describe('listMemories', () => {
    it('invokes list_memories with correct args and returns array', async () => {
      const result = await listMemories({ connectionId: 'conn-1' })
      expect(lastInvokedCmd).toBe('list_memories')
      expect(lastInvokedArgs?.connectionId).toBe('conn-1')
      expect(result).toHaveLength(1)
      expect(result[0].content).toBe('test memory')
    })
  })

  describe('deleteMemory', () => {
    it('invokes delete_memory with correct args', async () => {
      await deleteMemory({ memoryId: 42 })
      expect(lastInvokedCmd).toBe('delete_memory')
      expect(lastInvokedArgs?.memoryId).toBe(42)
    })
  })

  describe('searchMemories', () => {
    it('invokes search_memories with correct args and returns results', async () => {
      const result = await searchMemories({ sessionId: 'session-1', query: 'test', k: 5 })
      expect(lastInvokedCmd).toBe('search_memories')
      expect(lastInvokedArgs?.sessionId).toBe('session-1')
      expect(lastInvokedArgs?.query).toBe('test')
      expect(lastInvokedArgs?.k).toBe(5)
      expect(result).toHaveLength(1)
      expect(result[0].content).toBe('search result')
    })
  })

  describe('reembedMemories', () => {
    it('invokes reembed_memories with correct args', async () => {
      await reembedMemories({ connectionId: 'conn-1' })
      expect(lastInvokedCmd).toBe('reembed_memories')
      expect(lastInvokedArgs?.connectionId).toBe('conn-1')
    })
  })
})
