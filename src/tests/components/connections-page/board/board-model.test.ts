import { describe, expect, it } from 'vitest'
import {
  boardStateOf,
  buildBoardSections,
  hostLabel,
  isProfileOpen,
  openSessionOf,
  savedServersLabel,
  visibleConnectionCount,
} from '../../../../components/connections-page/board/board-model'
import type { ConnectionGroup, SavedConnection } from '../../../../types/connection'
import { makeActiveConnection, makeSavedConnection } from '../../../helpers/connection-test-utils'

const SEARCH = { kind: 'search', query: '' } as const
const READY = { status: 'ready' } as const

function group(id: string, name: string, sortOrder: number): ConnectionGroup {
  return { id: id, name: name, parentId: null, sortOrder: sortOrder, createdAt: '' }
}

function profiles(count: number): SavedConnection[] {
  return Array.from({ length: count }, (_, index) =>
    makeSavedConnection({
      id: `c${index}`,
      name: `Server ${index}`,
      groupId: index % 2 === 0 ? 'prod' : null,
      lastConnectedAt: index < 5 ? `2026-06-0${index + 1}T00:00:00Z` : null,
    })
  )
}

describe('boardStateOf', () => {
  it('picks loading, failure, URL, empty, no-match or sections', () => {
    const inputs = { load: READY, composer: SEARCH, savedCount: 2, visibleCount: 2 }
    expect(boardStateOf({ ...inputs, load: { status: 'idle' } })).toBe('loading')
    expect(boardStateOf({ ...inputs, load: { status: 'failed', message: 'x' } })).toBe('failed')
    expect(boardStateOf({ ...inputs, composer: { kind: 'rejected', reason: 'x' } })).toBe('url')
    expect(boardStateOf({ ...inputs, savedCount: 0 })).toBe('empty')
    expect(boardStateOf({ ...inputs, visibleCount: 0 })).toBe('no-match')
    expect(boardStateOf(inputs)).toBe('sections')
  })
})

describe('buildBoardSections', () => {
  const groups = [group('prod', 'Production', 0), group('empty', 'Empty', 1)]

  it('puts the four most recent first when more than six servers are saved', () => {
    const sections = buildBoardSections({
      savedConnections: profiles(7),
      connectionGroups: groups,
      query: '',
    })
    expect(sections.map((section) => section.title)).toEqual([
      'Recent',
      'Production',
      'Empty',
      'Ungrouped',
    ])
    expect(sections[0].connections.map((connection) => connection.id)).toEqual([
      'c4',
      'c3',
      'c2',
      'c1',
    ])
    expect(visibleConnectionCount(sections)).toBe(7)
  })

  it('drops Recent while filtering, at six or fewer servers, and before any connect', () => {
    const filtered = buildBoardSections({
      savedConnections: profiles(7),
      connectionGroups: groups,
      query: 'server 1',
    })
    expect(filtered.map((section) => section.key)).toEqual(['ungrouped'])
    const few = buildBoardSections({
      savedConnections: profiles(6),
      connectionGroups: [],
      query: '',
    })
    expect(few.map((section) => section.kind)).toEqual(['ungrouped'])
    const neverConnected = profiles(7).map((profile) => ({ ...profile, lastConnectedAt: null }))
    const withoutHistory = buildBoardSections({
      savedConnections: neverConnected,
      connectionGroups: [],
      query: '',
    })
    expect(withoutHistory.map((section) => section.kind)).not.toContain('recent')
  })
})

describe('labels and lookups', () => {
  it('shows the port only when it is not the default, and counts servers', () => {
    expect(hostLabel(makeSavedConnection({ host: 'db', port: 3306 }))).toBe('db')
    expect(hostLabel(makeSavedConnection({ host: 'db', port: 3307 }))).toBe('db:3307')
    expect(savedServersLabel(1)).toBe('1 saved server')
    expect(savedServersLabel(6)).toBe('6 saved servers')
  })

  it('finds the session already open for a profile', () => {
    const active = { 'sess-9': makeActiveConnection({ id: 'sess-9' }) }
    expect(openSessionOf(active, 'conn-1')).toBe('sess-9')
    expect(isProfileOpen(active, 'other')).toBe(false)
  })
})
