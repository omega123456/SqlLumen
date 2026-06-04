import type { AiMemory, MemoryScope } from '../../lib/ai-memory-commands'

/**
 * Deterministic AI-memory fixtures for Playwright / VITE_PLAYWRIGHT runs.
 *
 * All fixture data lives here (not inline in the playwright IPC mock switch).
 * Screenshots/E2E can override the per-scope sets via the window registry
 * helpers below.
 */

const FIXTURE_TS = Math.floor(new Date('2025-01-01T00:00:00.000Z').getTime() / 1000)

export const DEFAULT_GLOBAL_MEMORIES: AiMemory[] = [
  {
    id: 1,
    scope: 'global',
    connectionId: null,
    groupId: null,
    content: 'Always prefer CTEs over subqueries',
    createdAt: FIXTURE_TS,
    source: 'manual',
  },
]

export const DEFAULT_GROUP_MEMORIES: AiMemory[] = []

export const DEFAULT_CONNECTION_MEMORIES: AiMemory[] = []

interface MemoryOverrideStore {
  global?: AiMemory[]
  group?: Record<string, AiMemory[]>
  connection?: Record<string, AiMemory[]>
}

function getOverrideStore(): MemoryOverrideStore | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as Record<string, unknown>).__mockMemoriesData__ as
    | MemoryOverrideStore
    | undefined
}

export function getGlobalMemoriesFixture(): AiMemory[] {
  return getOverrideStore()?.global ?? DEFAULT_GLOBAL_MEMORIES
}

export function getGroupMemoriesFixture(groupId: string | null | undefined): AiMemory[] {
  const key = String(groupId ?? '')
  return getOverrideStore()?.group?.[key] ?? DEFAULT_GROUP_MEMORIES
}

export function getConnectionMemoriesFixture(
  connectionId: string | null | undefined
): AiMemory[] {
  const key = String(connectionId ?? '')
  return getOverrideStore()?.connection?.[key] ?? DEFAULT_CONNECTION_MEMORIES
}

/** Build a saved-memory response for `save_memory` from request args. */
export function getSavedMemoryFixture(args: Record<string, unknown> | undefined): AiMemory {
  const scope = (args?.scope as MemoryScope) ?? 'connection'
  return {
    id: 1,
    scope,
    connectionId: scope === 'connection' ? 'conn-playwright-1' : null,
    groupId: scope === 'group' ? 'grp-playwright-1' : null,
    content: String(args?.content ?? ''),
    createdAt: Math.floor(Date.now() / 1000),
    source: 'manual',
  }
}

/** Build a moved-memory response for `move_memory` from request args. */
export function getMovedMemoryFixture(args: Record<string, unknown> | undefined): AiMemory {
  const scope = (args?.toScope as MemoryScope) ?? 'connection'
  return {
    id: 99,
    scope,
    connectionId: scope === 'connection' ? String(args?.toConnectionId ?? '') || null : null,
    groupId: scope === 'group' ? String(args?.toGroupId ?? '') || null : null,
    content: 'moved memory',
    createdAt: Math.floor(Date.now() / 1000),
    source: 'manual',
  }
}
