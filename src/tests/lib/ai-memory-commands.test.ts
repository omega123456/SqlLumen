import { describe, it, expect, beforeEach } from 'vitest'
import { ipc } from '../ipc-mock'
import {
  saveMemory,
  listMemories,
  deleteMemory,
  searchMemories,
  reembedMemories,
} from '../../lib/ai-memory-commands'

beforeEach(() => {
  ipc.override('save_memory', (args) => ({
    id: 1,
    connectionId: 'conn-1',
    content: args?.content ?? '',
    createdAt: 1700000000,
    source: 'manual',
  }))
  ipc.override('list_memories', () => [
    {
      id: 1,
      connectionId: 'conn-1',
      content: 'test memory',
      createdAt: 1700000000,
      source: 'manual',
    },
  ])
  ipc.override('delete_memory', () => undefined)
  ipc.override('search_memories', () => [
    {
      id: 2,
      connectionId: 'conn-1',
      content: 'search result',
      createdAt: 1700000000,
      source: 'manual',
    },
  ])
  ipc.override('reembed_memories', () => undefined)
})

describe('ai-memory-commands', () => {
  describe('saveMemory', () => {
    it('invokes save_memory with correct args', async () => {
      const result = await saveMemory({ sessionId: 'session-1', content: 'hello world' })
      expect(ipc.calls('save_memory')).toEqual([{ sessionId: 'session-1', content: 'hello world' }])
      expect(result.id).toBe(1)
      expect(result.source).toBe('manual')
    })
  })

  describe('listMemories', () => {
    it('invokes list_memories with correct args and returns array', async () => {
      const result = await listMemories({ connectionId: 'conn-1' })
      expect(ipc.calls('list_memories')).toEqual([{ connectionId: 'conn-1' }])
      expect(result).toHaveLength(1)
      expect(result[0].content).toBe('test memory')
    })
  })

  describe('deleteMemory', () => {
    it('invokes delete_memory with correct args', async () => {
      await deleteMemory({ memoryId: 42 })
      expect(ipc.calls('delete_memory')).toEqual([{ memoryId: 42 }])
    })
  })

  describe('searchMemories', () => {
    it('invokes search_memories with correct args and returns results', async () => {
      const result = await searchMemories({ sessionId: 'session-1', query: 'test', k: 5 })
      expect(ipc.calls('search_memories')).toEqual([
        { sessionId: 'session-1', query: 'test', k: 5 },
      ])
      expect(result).toHaveLength(1)
      expect(result[0].content).toBe('search result')
    })
  })

  describe('reembedMemories', () => {
    it('invokes reembed_memories with correct args', async () => {
      await reembedMemories({ connectionId: 'conn-1' })
      expect(ipc.calls('reembed_memories')).toEqual([{ connectionId: 'conn-1' }])
    })
  })
})
