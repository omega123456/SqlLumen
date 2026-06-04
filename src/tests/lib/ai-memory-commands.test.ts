import { describe, it, expect, beforeEach } from 'vitest'
import { ipc } from '../ipc-mock'
import type { AiMemory } from '../../lib/ai-memory-commands'
import {
  saveMemory,
  listGlobalMemories,
  listGroupMemories,
  listConnectionMemories,
  deleteMemory,
  moveMemory,
  searchMemories,
  reembedAllMemories,
} from '../../lib/ai-memory-commands'

function makeMemory(overrides: Partial<AiMemory> = {}): AiMemory {
  return {
    id: 1,
    scope: 'connection',
    connectionId: 'conn-1',
    groupId: null,
    content: 'test memory',
    createdAt: 1700000000,
    source: 'manual',
    ...overrides,
  }
}

beforeEach(() => {
  ipc.override('save_memory', (args) =>
    makeMemory({
      scope: (args?.scope as AiMemory['scope']) ?? 'connection',
      content: (args?.content as string) ?? '',
    })
  )
  ipc.override('list_global_memories', () => [
    makeMemory({ id: 10, scope: 'global', connectionId: null, content: 'global note' }),
  ])
  ipc.override('list_group_memories', () => [
    makeMemory({ id: 20, scope: 'group', connectionId: null, groupId: 'grp-1', content: 'group note' }),
  ])
  ipc.override('list_connection_memories', () => [
    makeMemory({ id: 30, content: 'connection note' }),
  ])
  ipc.override('delete_memory', () => undefined)
  ipc.override('move_memory', (args) =>
    makeMemory({
      id: 99,
      scope: (args?.toScope as AiMemory['scope']) ?? 'global',
      connectionId: null,
      content: 'moved',
    })
  )
  ipc.override('search_memories', () => [
    makeMemory({ id: 2, content: 'search result' }),
  ])
  ipc.override('reembed_all_memories', () => undefined)
})

describe('ai-memory-commands', () => {
  describe('saveMemory', () => {
    it('invokes save_memory with sessionId, content and scope', async () => {
      const result = await saveMemory({
        sessionId: 'session-1',
        content: 'hello world',
        scope: 'global',
      })
      expect(ipc.calls('save_memory')).toEqual([
        { sessionId: 'session-1', content: 'hello world', scope: 'global' },
      ])
      expect(result.scope).toBe('global')
      expect(result.source).toBe('manual')
    })
  })

  describe('listGlobalMemories', () => {
    it('invokes list_global_memories with no args', async () => {
      const result = await listGlobalMemories()
      expect(ipc.calls('list_global_memories')).toHaveLength(1)
      expect(result[0].scope).toBe('global')
      expect(result[0].content).toBe('global note')
    })
  })

  describe('listGroupMemories', () => {
    it('invokes list_group_memories with groupId', async () => {
      const result = await listGroupMemories({ groupId: 'grp-1' })
      expect(ipc.calls('list_group_memories')).toEqual([{ groupId: 'grp-1' }])
      expect(result[0].scope).toBe('group')
      expect(result[0].groupId).toBe('grp-1')
    })
  })

  describe('listConnectionMemories', () => {
    it('invokes list_connection_memories with connectionId', async () => {
      const result = await listConnectionMemories({ connectionId: 'conn-1' })
      expect(ipc.calls('list_connection_memories')).toEqual([{ connectionId: 'conn-1' }])
      expect(result[0].scope).toBe('connection')
      expect(result[0].content).toBe('connection note')
    })
  })

  describe('deleteMemory', () => {
    it('invokes delete_memory with scope and memoryId', async () => {
      await deleteMemory({ scope: 'group', memoryId: 42 })
      expect(ipc.calls('delete_memory')).toEqual([{ scope: 'group', memoryId: 42 }])
    })
  })

  describe('moveMemory', () => {
    it('invokes move_memory with scope and owner args', async () => {
      const result = await moveMemory({
        memoryId: 5,
        fromScope: 'connection',
        toScope: 'global',
        fromConnectionId: 'conn-1',
      })
      expect(ipc.calls('move_memory')).toEqual([
        { memoryId: 5, fromScope: 'connection', toScope: 'global', fromConnectionId: 'conn-1' },
      ])
      expect(result.scope).toBe('global')
    })

    it('passes through group/connection target args', async () => {
      await moveMemory({
        memoryId: 7,
        fromScope: 'global',
        toScope: 'group',
        toGroupId: 'grp-2',
      })
      expect(ipc.calls('move_memory')).toEqual([
        { memoryId: 7, fromScope: 'global', toScope: 'group', toGroupId: 'grp-2' },
      ])
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

  describe('reembedAllMemories', () => {
    it('invokes reembed_all_memories with no args', async () => {
      await reembedAllMemories()
      expect(ipc.calls('reembed_all_memories')).toHaveLength(1)
    })
  })
})
