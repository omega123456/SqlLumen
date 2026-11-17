import { describe, expect, it } from 'vitest'
import {
  applyProfileDefaultDatabase,
  attachActiveConnection,
  reorderActiveConnections,
  setSessionDatabase,
} from '../../../stores/connection-store/connection-reducers'
import {
  isConnectionOfProfile,
  normalizeActiveConnectionOrder,
} from '../../../stores/connection-store/active-connections'
import type { ActiveConnection, SavedConnection } from '../../../types/connection'

const DEFAULT_PORT = 3306
const CONNECT_TIMEOUT_SECS = 10
const KEEPALIVE_INTERVAL_SECS = 60

function profile(id: string, overrides: Partial<SavedConnection> = {}): SavedConnection {
  return {
    id: id,
    name: id,
    host: 'localhost',
    port: DEFAULT_PORT,
    username: 'root',
    hasPassword: false,
    defaultDatabase: null,
    sslEnabled: false,
    sslCaPath: null,
    sslCertPath: null,
    sslKeyPath: null,
    color: null,
    groupId: null,
    readOnly: false,
    sortOrder: 0,
    connectTimeoutSecs: CONNECT_TIMEOUT_SECS,
    keepaliveIntervalSecs: KEEPALIVE_INTERVAL_SECS,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

function connection(sessionId: string, profileId = 'profile-1'): ActiveConnection {
  return {
    id: sessionId,
    profile: profile(profileId),
    status: 'connected',
    serverVersion: '8.0',
  }
}

function orderedState(sessionIds: string[]) {
  return {
    activeConnections: Object.fromEntries(
      sessionIds.map((sessionId) => [sessionId, connection(sessionId)])
    ),
    activeConnectionOrder: sessionIds,
  }
}

describe('active connections', () => {
  it('orders open sessions first by saved order, then by registration, without duplicates', () => {
    const { activeConnections } = orderedState(['a', 'b', 'c'])
    expect(normalizeActiveConnectionOrder(['c', 'gone', 'c', 'a'], activeConnections)).toEqual([
      'c',
      'a',
      'b',
    ])
  })

  it('matches a connection to its profile', () => {
    expect(isConnectionOfProfile(connection('a', 'profile-1'), 'profile-1')).toBe(true)
    expect(isConnectionOfProfile(connection('a', 'profile-1'), 'profile-2')).toBe(false)
  })
})

describe('connection reducers', () => {
  it('attaches a connection, selects it and clears the error', () => {
    const attached = attachActiveConnection(orderedState(['a']), connection('b'))
    expect(attached.activeConnectionOrder).toEqual(['a', 'b'])
    expect(attached.activeTabId).toBe('b')
    expect(attached.error).toBeNull()
    expect(attached.activeConnections.b.id).toBe('b')
  })

  it('reorders a connection and clamps the insert index', () => {
    const state = orderedState(['a', 'b', 'c'])
    expect(reorderActiveConnections(state, { sessionId: 'a', insertIndex: 99 })).toEqual({
      activeConnectionOrder: ['b', 'c', 'a'],
    })
    expect(reorderActiveConnections(state, { sessionId: 'c', insertIndex: 0 })).toEqual({
      activeConnectionOrder: ['c', 'a', 'b'],
    })
    expect(reorderActiveConnections(state, { sessionId: 'missing', insertIndex: 0 })).toBe(state)
  })

  it('sets the session database', () => {
    const updated = setSessionDatabase(orderedState(['a']), {
      sessionId: 'a',
      sessionDatabase: 'shop',
    })
    expect(updated.activeConnections.a.sessionDatabase).toBe('shop')
  })

  it('applies a profile default database to its sessions and saved profile only', () => {
    const state = {
      activeConnections: { a: connection('a', 'profile-1'), b: connection('b', 'profile-2') },
      savedConnections: [profile('profile-1'), profile('profile-2')],
    }
    const updatedProfile = profile('profile-1', { defaultDatabase: 'shop' })
    const applied = applyProfileDefaultDatabase(state, updatedProfile)
    expect(applied.activeConnections.a.profile).toBe(updatedProfile)
    expect(applied.activeConnections.b).toBe(state.activeConnections.b)
    expect(applied.savedConnections.map((saved) => saved.defaultDatabase)).toEqual(['shop', null])
  })
})
