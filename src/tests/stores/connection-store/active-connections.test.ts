import { describe, expect, it } from 'vitest'
import {
  isConnectionOfProfile,
  normalizeActiveConnectionOrder,
} from '../../../stores/connection-store/active-connections'
import type { ActiveConnection, SavedConnection } from '../../../types/connection'

function activeConnection(sessionId: string, profileId: string): ActiveConnection {
  const profile = { id: profileId } as SavedConnection
  return { id: sessionId, profile: profile, status: 'connected', serverVersion: '8.0' }
}

describe('active connections', () => {
  it('keeps known order, drops closed sessions and appends unseen ones once', () => {
    const activeConnections = {
      first: activeConnection('first', 'p1'),
      second: activeConnection('second', 'p2'),
    }
    const order = normalizeActiveConnectionOrder(['second', 'closed', 'second'], activeConnections)
    expect(order).toEqual(['second', 'first'])
  })

  it('matches a session to its profile', () => {
    expect(isConnectionOfProfile(activeConnection('s1', 'p1'), 'p1')).toBe(true)
    expect(isConnectionOfProfile(activeConnection('s1', 'p1'), 'p2')).toBe(false)
  })
})
