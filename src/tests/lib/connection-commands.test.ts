import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipc } from '../ipc-mock'
import {
  saveConnection,
  getConnection,
  listConnections,
  updateConnection,
  deleteConnection,
  createConnectionGroup,
  listConnectionGroups,
  updateConnectionGroup,
  deleteConnectionGroup,
  testConnection,
  openConnection,
  closeConnection,
  getConnectionStatus,
  listOpenConnectionSessions,
} from '../../lib/connection-commands'
import type { ConnectionFormData } from '../../types/connection'

beforeEach(() => {
  vi.clearAllMocks()
})

const sampleFormData: ConnectionFormData = {
  name: 'Test DB',
  host: 'localhost',
  port: 3306,
  username: 'root',
  password: 'secret',
  defaultDatabase: 'mydb',
  sslMode: 'disabled',
  sslCaPath: null,
  sslCertPath: null,
  sslKeyPath: null,
  color: null,
  groupId: null,
  readOnly: false,
  connectTimeoutSecs: 10,
  keepaliveIntervalSecs: 60,
}

// --- Connection CRUD ---

describe('connection profile commands', () => {
  it('saves and updates a profile with an empty password sent as null and an optional clearPassword', async () => {
    ipc.override('save_connection', () => 'new-uuid-123')

    expect(await saveConnection(sampleFormData)).toBe('new-uuid-123')
    await saveConnection({ ...sampleFormData, password: '' })
    await updateConnection('abc', sampleFormData)
    await updateConnection('abc', { ...sampleFormData, password: '' }, { clearPassword: true })

    expect(ipc.calls('save_connection')).toEqual([
      { data: { ...sampleFormData, password: 'secret', sortOrder: 0 } },
      { data: expect.objectContaining({ password: null }) },
    ])
    expect(ipc.payloads('update_connection')).toEqual([
      {
        id: 'abc',
        data: { ...sampleFormData, password: 'secret', clearPassword: false, sortOrder: 0 },
      },
      {
        id: 'abc',
        data: expect.objectContaining({ password: null, clearPassword: true }),
      },
    ])
  })

  it('tests a connection with only the test-relevant fields and the saved profile id', async () => {
    const testResult = {
      success: true,
      serverVersion: '8.0.35',
      authMethod: 'mysql_native_password',
      sslStatus: 'Not using SSL',
      connectionTimeMs: 42,
      errorMessage: null,
    }
    ipc.override('test_connection', () => testResult)

    expect(await testConnection(sampleFormData, 'conn-42')).toEqual(testResult)

    expect(ipc.calls('test_connection')).toEqual([
      {
        input: {
          host: 'localhost',
          port: 3306,
          username: 'root',
          password: 'secret',
          profileId: 'conn-42',
          defaultDatabase: 'mydb',
          sslMode: 'disabled',
          sslCaPath: null,
          sslCertPath: null,
          sslKeyPath: null,
          connectTimeoutSecs: 10,
        },
      },
    ])
  })

  it('sends plain ids and names for the lookup, group and session commands', async () => {
    const connections = [
      { id: '1', name: 'A' },
      { id: '2', name: 'B' },
    ]
    const groups = [{ id: '1', name: 'Prod' }]
    ipc.override('get_connection', () => connections[0])
    ipc.override('list_connections', () => connections)
    ipc.override('create_connection_group', () => 'group-uuid-123')
    ipc.override('list_connection_groups', () => groups)
    ipc.override('open_connection', () => ({ sessionId: 'sess-1', serverVersion: '8.0.35' }))
    ipc.override('get_connection_status', () => 'connected')

    expect(await getConnection('abc')).toEqual(connections[0])
    expect(await listConnections()).toEqual(connections)
    expect(await createConnectionGroup('Production')).toBe('group-uuid-123')
    expect(await listConnectionGroups()).toEqual(groups)
    expect(await openConnection('conn-1')).toEqual({ sessionId: 'sess-1', serverVersion: '8.0.35' })
    expect(await getConnectionStatus('conn-1')).toBe('connected')
    await deleteConnection('abc')
    await updateConnectionGroup({ id: 'grp-1', name: 'New name', color: '#3366ff' })
    await deleteConnectionGroup('grp-1')
    await closeConnection('conn-1')

    expect(ipc.calls('get_connection')).toEqual([{ id: 'abc' }])
    expect(ipc.calls('create_connection_group')).toEqual([{ name: 'Production' }])
    expect(ipc.calls('open_connection')).toEqual([
      { payload: { profileId: 'conn-1', password: null } },
    ])
    expect(ipc.calls('get_connection_status')).toEqual([{ connectionId: 'conn-1' }])
    expect(ipc.calls('delete_connection')).toEqual([{ id: 'abc' }])
    expect(ipc.payloads('update_connection_group')).toEqual([
      { id: 'grp-1', name: 'New name', color: '#3366ff' },
    ])
    expect(ipc.calls('delete_connection_group')).toEqual([{ id: 'grp-1' }])
    expect(ipc.calls('close_connection')).toEqual([{ connectionId: 'conn-1' }])
  })

  it('returns an empty list and a null status from the default fixtures and unknown connections', async () => {
    ipc.override('get_connection_status', () => null)

    expect(await listConnections()).toEqual([])
    expect(await listConnectionGroups()).toEqual([])
    expect(await getConnectionStatus('unknown')).toBeNull()
  })
})

describe('listOpenConnectionSessions', () => {
  it('returns the native registry sessions', async () => {
    const sessions = [
      {
        sessionId: 'session-1',
        profileId: 'profile-1',
        status: 'reconnecting' as const,
        serverVersion: '8.0.35',
        sessionDatabase: 'reporting',
      },
    ]
    ipc.override('list_open_connection_sessions', () => sessions)

    await expect(listOpenConnectionSessions()).resolves.toEqual(sessions)
    expect(ipc.calls('list_open_connection_sessions')).toEqual([{}])
  })
})
