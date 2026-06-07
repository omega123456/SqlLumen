import { describe, expect, it } from 'vitest'
import {
  buildCommandPaletteSearchIndex,
  getRecentPaletteResults,
  normalizePaletteSearchQuery,
  searchPaletteObjects,
} from '../../lib/command-palette-search'
import type { CommandPaletteRecentEntry } from '../../stores/command-palette-recents-store'
import type { SearchableObject } from '../../types/schema'

const SEARCHABLE_OBJECTS: SearchableObject[] = [
  { database: 'app_main', objectType: 'table', name: 'users' },
  { database: 'app_main', objectType: 'view', name: 'active_users' },
  { database: 'app_main', objectType: 'table', name: 'usable_items' },
  { database: 'analytics', objectType: 'procedure', name: 'user_sync' },
  { database: 'analytics', objectType: 'function', name: 'usage_score' },
  { database: 'ops', objectType: 'trigger', name: 'users_after_insert' },
]

const RECENTS: CommandPaletteRecentEntry[] = [
  {
    database: 'analytics',
    objectType: 'procedure',
    name: 'user_sync',
    lastUsedAt: '2026-06-06T12:05:00.000Z',
  },
  {
    database: 'app_main',
    objectType: 'table',
    name: 'users',
    lastUsedAt: '2026-06-06T12:04:00.000Z',
  },
  {
    database: 'ops',
    objectType: 'trigger',
    name: 'users_after_insert',
    lastUsedAt: '2026-06-06T12:03:00.000Z',
  },
]

describe('command-palette-search', () => {
  const index = buildCommandPaletteSearchIndex(SEARCHABLE_OBJECTS)

  it('normalizes wildcard queries by stripping asterisks', () => {
    expect(normalizePaletteSearchQuery('  us*s  ')).toBe('uss')
    expect(normalizePaletteSearchQuery('***')).toBe('')
  })

  it('returns fuzzy matches and preserves highlight ranges from Fuse', () => {
    const results = searchPaletteObjects(index, {
      query: 'usr',
    })

    expect(results.map((result) => result.name)).toContain('users')

    const usersResult = results.find((result) => result.name === 'users')
    expect(usersResult?.matchIndices).toEqual([[0, 1], [3, 3]])
  })

  it('supports wildcard gap matching with ordered substrings', () => {
    const results = searchPaletteObjects(index, {
      query: 'us*s',
    })

    expect(results.map((result) => result.name)).toEqual(
      expect.arrayContaining(['users', 'usable_items'])
    )
  })

  it('requires every wildcard segment to appear in order and excludes non-matches', () => {
    const wildcardObjects: SearchableObject[] = [
      { database: 'platform', objectType: 'table', name: 'communication_log' },
      { database: 'platform', objectType: 'table', name: 'communication_cron_log' },
      { database: 'platform', objectType: 'table', name: 'communication_log_email' },
      { database: 'platform', objectType: 'table', name: 'communication_assets' },
      { database: 'platform', objectType: 'table', name: 'communication_brands' },
      { database: 'platform', objectType: 'table', name: 'log_communication' },
    ]
    const wildcardIndex = buildCommandPaletteSearchIndex(wildcardObjects)

    const results = searchPaletteObjects(wildcardIndex, { query: 'communica*log' })

    expect(results.map((result) => result.name).sort()).toEqual([
      'communication_cron_log',
      'communication_log',
      'communication_log_email',
    ])
  })

  it('produces highlight ranges for each matched wildcard segment', () => {
    const wildcardObjects: SearchableObject[] = [
      { database: 'platform', objectType: 'table', name: 'communication_log' },
    ]
    const wildcardIndex = buildCommandPaletteSearchIndex(wildcardObjects)

    const results = searchPaletteObjects(wildcardIndex, { query: 'communica*log' })

    expect(results[0]?.matchIndices).toEqual([
      [0, 8],
      [14, 16],
    ])
  })

  it('applies type and database filters before returning matches', () => {
    const results = searchPaletteObjects(index, {
      query: 'user',
      filters: {
        objectType: 'table',
        database: 'app_main',
      },
    })

    expect(results).toEqual([
      expect.objectContaining({
        database: 'app_main',
        objectType: 'table',
        name: 'users',
      }),
    ])
  })

  it('boosts recent objects ahead of comparable matches', () => {
    const results = searchPaletteObjects(index, {
      query: 'user',
      recents: RECENTS,
    })

    expect(results[0]).toEqual(
      expect.objectContaining({
        database: 'analytics',
        objectType: 'procedure',
        name: 'user_sync',
        recentRank: 0,
      })
    )
    expect(results.findIndex((result) => result.name === 'user_sync')).toBeLessThan(
      results.findIndex((result) => result.name === 'users')
    )
  })

  it('returns an empty result set for queries that normalize to empty', () => {
    expect(
      searchPaletteObjects(index, {
        query: '***',
        recents: RECENTS,
      })
    ).toEqual([])
  })

  it('orders empty-query recents, filters them, and skips stale entries', () => {
    const recents = getRecentPaletteResults(SEARCHABLE_OBJECTS, {
      recents: [
        ...RECENTS,
        {
          database: 'missing',
          objectType: 'table',
          name: 'gone',
          lastUsedAt: '2026-06-06T12:00:00.000Z',
        },
      ],
      filters: {
        database: 'app_main',
      },
    })

    expect(recents).toEqual([
      expect.objectContaining({
        database: 'app_main',
        objectType: 'table',
        name: 'users',
        recentRank: 1,
        matchIndices: [],
      }),
    ])
  })
})
