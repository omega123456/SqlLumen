/**
 * Tests for session-restore-commands IPC wrappers.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ipc } from '../ipc-mock'
import type { SessionState } from '../../lib/session-restore-commands'
import { saveSessionState, loadSessionState } from '../../lib/session-restore-commands'

let getSettingReturn: string | null = null

beforeEach(() => {
  getSettingReturn = null
  ipc.override('set_setting', () => null)
  ipc.override('get_setting', () => getSettingReturn)
})

describe('saveSessionState', () => {
  it('serializes state and calls set_setting with correct key', async () => {
    const state: SessionState = {
      version: 1,
      connections: [
        {
          profileId: 'profile-1',
          activeTabIndex: 0,
          tabs: [{ type: 'query-editor', tabId: 'tab-1', sql: 'SELECT 1', label: 'Query 1' }],
        },
      ],
    }

    await saveSessionState(state)

    const args = ipc.calls('set_setting')[0] as { key: string; value: string }
    expect(args.key).toBe('session.state')
    expect(args.value).not.toBeNull()
    const parsed = JSON.parse(args.value)
    expect(parsed.version).toBe(1)
    expect(parsed.connections).toHaveLength(1)
    expect(parsed.connections[0].profileId).toBe('profile-1')
    expect(parsed.connections[0].tabs[0].sql).toBe('SELECT 1')
  })

  it('serializes empty connections array', async () => {
    const state: SessionState = { version: 1, connections: [] }
    await saveSessionState(state)

    const args = ipc.calls('set_setting')[0] as { key: string; value: string }
    expect(args.key).toBe('session.state')
    const parsed = JSON.parse(args.value)
    expect(parsed.connections).toHaveLength(0)
  })
})

describe('loadSessionState', () => {
  it('returns null when no state is stored', async () => {
    getSettingReturn = null
    const result = await loadSessionState()
    expect(result).toBeNull()
  })

  it('returns null when stored value is "null" string', async () => {
    getSettingReturn = 'null'
    const result = await loadSessionState()
    expect(result).toBeNull()
  })

  it('returns parsed state when valid JSON is stored', async () => {
    const state: SessionState = {
      version: 1,
      connections: [
        {
          profileId: 'p1',
          activeTabIndex: 1,
          tabs: [
            {
              type: 'table-data',
              tabId: 't1',
              databaseName: 'db1',
              tableName: 'users',
              parentQueryTabId: 'q1',
              objectType: 'view',
            },
            { type: 'query-editor', tabId: 't2', sql: 'SELECT 1' },
          ],
        },
      ],
    }
    getSettingReturn = JSON.stringify(state)

    const result = await loadSessionState()
    expect(result).not.toBeNull()
    expect(result!.version).toBe(1)
    expect(result!.connections).toHaveLength(1)
    expect(result!.connections[0].tabs[0].type).toBe('table-data')
    expect(result!.connections[0].tabs[0]).toMatchObject({
      parentQueryTabId: 'q1',
      objectType: 'view',
    })
  })

  it('returns null for invalid JSON', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    getSettingReturn = 'not-json{{'
    const result = await loadSessionState()
    expect(result).toBeNull()
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('returns null for wrong version', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    getSettingReturn = JSON.stringify({ version: 99, connections: [] })
    const result = await loadSessionState()
    expect(result).toBeNull()
    warnSpy.mockRestore()
  })

  it('returns null when connections field is missing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    getSettingReturn = JSON.stringify({ version: 1 })
    const result = await loadSessionState()
    expect(result).toBeNull()
    warnSpy.mockRestore()
  })
})
