import { describe, expect, it } from 'vitest'
import {
  adoptSiblingBuild,
  createDefaultConnectionIndexState,
  isBuildingOrReady,
  markIndexBuildFailed,
  markIndexBuilding,
  registerIndexSession,
  setReportedIndexStatus,
  settleTriggeredBuildStatus,
  unregisterIndexSession,
  updateSessions,
} from '../../../stores/schema-index-store/schema-index-reducers'
import type { ConnectionIndexState } from '../../../stores/schema-index-store'

const TABLES_DONE = 4
const TABLES_TOTAL = 9
const BUILD_TIMESTAMP = 1_700_000_000

const EMPTY_REGISTRY = { connections: {}, profileToSessions: {}, sessionToProfile: {} }

function indexState(overrides: Partial<ConnectionIndexState> = {}): ConnectionIndexState {
  return { ...createDefaultConnectionIndexState(), ...overrides }
}

describe('schema index reducers', () => {
  it('registers sessions under their profile', () => {
    const first = registerIndexSession(EMPTY_REGISTRY, { sessionId: 's1', profileId: 'p1' })
    const second = registerIndexSession(first, { sessionId: 's2', profileId: 'p1' })
    expect(second.profileToSessions).toEqual({ p1: ['s1', 's2'] })
    expect(second.sessionToProfile).toEqual({ s1: 'p1', s2: 'p1' })
    expect(second.connections.s2).toEqual(createDefaultConnectionIndexState())
  })

  it('unregisters a session and drops a profile with no sessions left', () => {
    const first = registerIndexSession(EMPTY_REGISTRY, { sessionId: 's1', profileId: 'p1' })
    const second = registerIndexSession(first, { sessionId: 's2', profileId: 'p1' })
    const withOneLeft = unregisterIndexSession(second, 's1')
    expect(withOneLeft.profileToSessions).toEqual({ p1: ['s2'] })
    expect(unregisterIndexSession(withOneLeft, 's2')).toEqual(EMPTY_REGISTRY)
    expect(unregisterIndexSession(second, 'unknown')).toBe(second)
  })

  it('updates the listed sessions, seeding missing ones with the default state', () => {
    const state = { connections: { s1: indexState({ status: 'ready' }) } }
    const updated = updateSessions(state, {
      sessionIds: ['s1', 's2'],
      update: (connection) => ({ ...connection, tablesDone: TABLES_DONE }),
    })
    expect(updated.connections.s1).toMatchObject({ status: 'ready', tablesDone: TABLES_DONE })
    expect(updated.connections.s2).toMatchObject({ status: 'stale', tablesDone: TABLES_DONE })
  })

  it('records the reported status of a known session', () => {
    const state = { connections: { s1: indexState() } }
    expect(
      setReportedIndexStatus(state, { sessionId: 's1', status: 'ready' }).connections.s1.status
    ).toBe('ready')
    expect(setReportedIndexStatus(state, { sessionId: 'gone', status: 'ready' })).toBe(state)
  })

  it('settles a triggered build only while the session is building or stale', () => {
    const building = { connections: { s1: indexState({ status: 'building' }) } }
    const settled = settleTriggeredBuildStatus(building, {
      sessionId: 's1',
      status: 'not_configured',
    })
    expect(settled.connections.s1.status).toBe('not_configured')
    const ready = { connections: { s1: indexState({ status: 'ready' }) } }
    expect(settleTriggeredBuildStatus(ready, { sessionId: 's1', status: 'stale' })).toBe(ready)
    expect(settleTriggeredBuildStatus(ready, { sessionId: 'gone', status: 'stale' })).toBe(ready)
  })

  it('adopts the progress of a sibling build', () => {
    const sibling = indexState({
      status: 'building',
      phase: 'embedding',
      tablesDone: TABLES_DONE,
      tablesTotal: TABLES_TOTAL,
      lastBuildTimestamp: BUILD_TIMESTAMP,
    })
    const adopted = adoptSiblingBuild({ connections: {} }, { sessionId: 's2', sibling: sibling })
    expect(adopted.connections.s2).toEqual(sibling)
  })

  it('marks a build as started and as failed', () => {
    const state = {
      connections: { s1: indexState({ tablesDone: TABLES_DONE, phase: 'embedding' }) },
    }
    expect(markIndexBuilding(state, 's1').connections.s1).toMatchObject({
      status: 'building',
      phase: null,
      tablesDone: 0,
      tablesTotal: 0,
    })
    expect(
      markIndexBuildFailed(state, { sessionId: 's1', message: 'boom' }).connections.s1
    ).toMatchObject({ status: 'error', error: 'boom' })
  })

  it('recognises a session that is building or ready', () => {
    expect(isBuildingOrReady(undefined)).toBe(false)
    expect(isBuildingOrReady(indexState({ status: 'stale' }))).toBe(false)
    expect(isBuildingOrReady(indexState({ status: 'ready' }))).toBe(true)
  })
})
