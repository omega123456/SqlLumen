import Fuse from 'fuse.js'
import type { FuseResult, RangeTuple } from 'fuse.js'
import type { CommandPaletteRecentEntry } from '../stores/command-palette-recents-store'
import type { PaletteTypeFilter, SearchableObject } from '../types/schema'

const SEARCH_KEYS = ['name'] as const
const SEARCH_THRESHOLD = 0.4
const RECENCY_SCORE_BOOST = 0.08
const RECENT_RESULTS_LIMIT = 5

export interface PaletteSearchFilters {
  database?: string | null
  objectType?: PaletteTypeFilter | null
}

export interface PaletteSearchResult extends SearchableObject {
  score: number
  matchIndices: ReadonlyArray<readonly [number, number]>
  recentRank: number | null
}

export interface CommandPaletteSearchIndex {
  readonly objects: ReadonlyArray<SearchableObject>
  readonly fuse: Fuse<SearchableObject>
}

export interface SearchPaletteObjectsOptions {
  query: string
  filters?: PaletteSearchFilters
  recents?: ReadonlyArray<CommandPaletteRecentEntry>
  limit?: number
}

export interface GetRecentPaletteResultsOptions {
  filters?: PaletteSearchFilters
  recents?: ReadonlyArray<CommandPaletteRecentEntry>
  limit?: number
}

function makeObjectKey(object: SearchableObject): string {
  return `${object.database}\u0000${object.objectType}\u0000${object.name}`
}

function normalizeQuery(query: string): string {
  return query.split('*').join('').trim()
}

function parseWildcardSegments(query: string): string[] {
  return query
    .split('*')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
}

function matchWildcardSegments(
  name: string,
  segments: ReadonlyArray<string>
): Array<[number, number]> | null {
  const lowerName = name.toLowerCase()
  const indices: Array<[number, number]> = []
  let cursor = 0

  for (const segment of segments) {
    const found = lowerName.indexOf(segment.toLowerCase(), cursor)
    if (found === -1) {
      return null
    }
    indices.push([found, found + segment.length - 1])
    cursor = found + segment.length
  }

  return indices
}

function matchesFilters(object: SearchableObject, filters?: PaletteSearchFilters): boolean {
  if (!filters) {
    return true
  }

  if (filters.database && object.database !== filters.database) {
    return false
  }

  if (filters.objectType && object.objectType !== filters.objectType) {
    return false
  }

  return true
}

function getRecentRankMap(
  recents: ReadonlyArray<CommandPaletteRecentEntry> | undefined
): Map<string, number> {
  const recentRankMap = new Map<string, number>()

  if (!recents) {
    return recentRankMap
  }

  for (const [index, recent] of recents.entries()) {
    const key = `${recent.database}\u0000${recent.objectType}\u0000${recent.name}`
    if (!recentRankMap.has(key)) {
      recentRankMap.set(key, index)
    }
  }

  return recentRankMap
}

function getMatchIndices(result: FuseResult<SearchableObject>): ReadonlyArray<readonly [number, number]> {
  const nameMatch = result.matches?.find((match) => match.key === 'name')
  return (nameMatch?.indices ?? []) as ReadonlyArray<RangeTuple>
}

function sortByRecencyThenName(
  left: SearchableObject,
  right: SearchableObject,
  recentRankMap: Map<string, number>
): number {
  const leftRecentRank = recentRankMap.get(makeObjectKey(left)) ?? Number.POSITIVE_INFINITY
  const rightRecentRank = recentRankMap.get(makeObjectKey(right)) ?? Number.POSITIVE_INFINITY

  if (leftRecentRank !== rightRecentRank) {
    return leftRecentRank - rightRecentRank
  }

  const databaseCompare = left.database.localeCompare(right.database)
  if (databaseCompare !== 0) {
    return databaseCompare
  }

  const nameCompare = left.name.localeCompare(right.name)
  if (nameCompare !== 0) {
    return nameCompare
  }

  return left.objectType.localeCompare(right.objectType)
}

export function buildCommandPaletteSearchIndex(
  objects: ReadonlyArray<SearchableObject>
): CommandPaletteSearchIndex {
  return {
    objects: [...objects],
    fuse: new Fuse(objects, {
      keys: [...SEARCH_KEYS],
      includeMatches: true,
      includeScore: true,
      ignoreLocation: true,
      threshold: SEARCH_THRESHOLD,
      shouldSort: true,
      minMatchCharLength: 1,
    }),
  }
}

interface CandidateMatch {
  item: SearchableObject
  baseScore: number
  matchIndices: ReadonlyArray<readonly [number, number]>
}

function findCandidateMatches(
  index: CommandPaletteSearchIndex,
  query: string
): CandidateMatch[] | null {
  if (query.includes('*')) {
    const segments = parseWildcardSegments(query)
    if (segments.length === 0) {
      return null
    }

    const candidates: CandidateMatch[] = []
    for (const item of index.objects) {
      const matchIndices = matchWildcardSegments(item.name, segments)
      if (!matchIndices) {
        continue
      }
      const matchedChars = matchIndices.reduce((sum, [start, end]) => sum + (end - start + 1), 0)
      // Earlier first match and fewer unmatched characters rank higher (lower is better).
      const baseScore = (matchIndices[0][0] + (item.name.length - matchedChars)) / 1000
      candidates.push({ item, baseScore, matchIndices })
    }
    return candidates
  }

  const normalizedQuery = normalizeQuery(query)
  if (!normalizedQuery) {
    return null
  }

  return index.fuse.search(normalizedQuery).map((result) => ({
    item: result.item,
    baseScore: result.score ?? 1,
    matchIndices: getMatchIndices(result),
  }))
}

export function searchPaletteObjects(
  index: CommandPaletteSearchIndex,
  options: SearchPaletteObjectsOptions
): PaletteSearchResult[] {
  const candidates = findCandidateMatches(index, options.query)
  if (!candidates) {
    return []
  }

  const recentRankMap = getRecentRankMap(options.recents)
  const filteredKeys = new Set(
    index.objects.filter((object) => matchesFilters(object, options.filters)).map(makeObjectKey)
  )

  const rankedResults = candidates
    .filter((candidate) => filteredKeys.has(makeObjectKey(candidate.item)))
    .map((candidate) => {
      const recentRank = recentRankMap.get(makeObjectKey(candidate.item)) ?? null
      const recencyBoost =
        recentRank === null ? 0 : Math.max(RECENCY_SCORE_BOOST - recentRank * 0.01, 0.01)
      const baseScore = candidate.baseScore

      return {
        ...candidate.item,
        score: Math.max(baseScore - recencyBoost, 0),
        matchIndices: candidate.matchIndices,
        recentRank,
        _baseScore: baseScore,
      }
    })
    .sort((left, right) => {
      if (left.score !== right.score) {
        return left.score - right.score
      }

      if (left._baseScore !== right._baseScore) {
        return left._baseScore - right._baseScore
      }

      if (left.recentRank !== right.recentRank) {
        return (left.recentRank ?? Number.POSITIVE_INFINITY) -
          (right.recentRank ?? Number.POSITIVE_INFINITY)
      }

      const databaseCompare = left.database.localeCompare(right.database)
      if (databaseCompare !== 0) {
        return databaseCompare
      }

      const nameCompare = left.name.localeCompare(right.name)
      if (nameCompare !== 0) {
        return nameCompare
      }

      return left.objectType.localeCompare(right.objectType)
    })
    .map(({ _baseScore: _discardedBaseScore, ...result }) => result)

  return typeof options.limit === 'number' ? rankedResults.slice(0, options.limit) : rankedResults
}

export function getRecentPaletteResults(
  objects: ReadonlyArray<SearchableObject>,
  options: GetRecentPaletteResultsOptions = {}
): PaletteSearchResult[] {
  const recentRankMap = getRecentRankMap(options.recents)
  const objectsByKey = new Map(objects.map((object) => [makeObjectKey(object), object]))
  const results: PaletteSearchResult[] = []
  const seen = new Set<string>()

  for (const recent of options.recents ?? []) {
    const key = `${recent.database}\u0000${recent.objectType}\u0000${recent.name}`
    if (seen.has(key)) {
      continue
    }

    const object = objectsByKey.get(key)
    if (!object || !matchesFilters(object, options.filters)) {
      continue
    }

    seen.add(key)
    results.push({
      ...object,
      score: 0,
      matchIndices: [],
      recentRank: recentRankMap.get(key) ?? null,
    })
  }

  const sortedResults = results.sort((left, right) =>
    sortByRecencyThenName(left, right, recentRankMap)
  )
  const limit = options.limit ?? RECENT_RESULTS_LIMIT
  return sortedResults.slice(0, limit)
}

export function normalizePaletteSearchQuery(query: string): string {
  return normalizeQuery(query)
}
