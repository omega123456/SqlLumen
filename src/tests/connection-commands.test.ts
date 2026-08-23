import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipc } from './ipc-mock'
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
} from '../lib/connection-commands'
import type { ConnectionFormData } from '../types/connection'

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
  sslEnabled: false,
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

describe('saveConnection', () => {
  it('calls invoke with correct command and args', async () => {
    ipc.override('save_connection', () => 'new-uuid-123')
    const result = await saveConnection(sampleFormData)
    expect(ipc.calls('save_connection')).toEqual([
      {
        data: {
          ...sampleFormData,
          password: 'secret',
          sortOrder: 0,
        },
      },
    ])
    expect(result).toBe('new-uuid-123')
  })

  it('converts empty password to null', async () => {
    ipc.override('save_connection', () => 'new-uuid-456')
    await saveConnection({ ...sampleFormData, password: '' })
    expect(ipc.calls('save_connection')).toEqual([
      {
        data: expect.objectContaining({ password: null }),
      },
    ])
  })

  it('propagates errors from invoke', async () => {
    ipc.override('save_connection', () => {
      throw new Error('Save failed')
    })
    await expect(saveConnection(sampleFormData)).rejects.toThrow('Save failed')
  })
})

describe('getConnection', () => {
  it('calls invoke with correct command and args', async () => {
    const mockConnection = { id: 'abc', name: 'Test' }
    ipc.override('get_connection', () => mockConnection)
    const result = await getConnection('abc')
    expect(ipc.calls('get_connection')).toEqual([{ id: 'abc' }])
    expect(result).toEqual(mockConnection)
  })

  it('propagates errors from invoke', async () => {
    ipc.override('get_connection', () => {
      throw new Error('Not found')
    })
    await expect(getConnection('missing')).rejects.toThrow('Not found')
  })
})

describe('listConnections', () => {
  it('calls invoke with correct command name', async () => {
    const result = await listConnections()
    expect(ipc.calls('list_connections')).toEqual([{}])
    expect(result).toEqual([])
  })

  it('returns array of connections', async () => {
    const mockList = [
      { id: '1', name: 'A' },
      { id: '2', name: 'B' },
    ]
    ipc.override('list_connections', () => mockList)
    const result = await listConnections()
    expect(result).toEqual(mockList)
  })
})

describe('updateConnection', () => {
  it('calls invoke with correct command and args', async () => {
    await updateConnection('abc', sampleFormData)
    expect(ipc.calls('update_connection')).toEqual([
      {
        id: 'abc',
        data: {
          ...sampleFormData,
          password: 'secret',
          clearPassword: false,
          sortOrder: 0,
        },
      },
    ])
  })

  it('converts empty password to null for update', async () => {
    await updateConnection('abc', { ...sampleFormData, password: '' })
    expect(ipc.calls('update_connection')).toEqual([
      {
        id: 'abc',
        data: expect.objectContaining({ password: null, clearPassword: false }),
      },
    ])
  })

  it('passes clearPassword when requested', async () => {
    await updateConnection('abc', { ...sampleFormData, password: '' }, { clearPassword: true })
    expect(ipc.calls('update_connection')).toEqual([
      {
        id: 'abc',
        data: expect.objectContaining({ password: null, clearPassword: true }),
      },
    ])
  })

  it('propagates errors from invoke', async () => {
    ipc.override('update_connection', () => {
      throw new Error('Update failed')
    })
    await expect(updateConnection('abc', sampleFormData)).rejects.toThrow('Update failed')
  })
})

describe('deleteConnection', () => {
  it('calls invoke with correct command and args', async () => {
    await deleteConnection('abc')
    expect(ipc.calls('delete_connection')).toEqual([{ id: 'abc' }])
  })

  it('propagates errors from invoke', async () => {
    ipc.override('delete_connection', () => {
      throw new Error('Delete failed')
    })
    await expect(deleteConnection('abc')).rejects.toThrow('Delete failed')
  })
})

// --- Group CRUD ---

describe('createConnectionGroup', () => {
  it('calls invoke with correct command and args', async () => {
    ipc.override('create_connection_group', () => 'group-uuid-123')
    const result = await createConnectionGroup('Production')
    expect(ipc.calls('create_connection_group')).toEqual([{ name: 'Production' }])
    expect(result).toBe('group-uuid-123')
  })

  it('propagates errors from invoke', async () => {
    ipc.override('create_connection_group', () => {
      throw new Error('Create group failed')
    })
    await expect(createConnectionGroup('Prod')).rejects.toThrow('Create group failed')
  })
})

describe('listConnectionGroups', () => {
  it('calls invoke with correct command name', async () => {
    const result = await listConnectionGroups()
    expect(ipc.calls('list_connection_groups')).toEqual([{}])
    expect(result).toEqual([])
  })

  it('returns array of groups', async () => {
    const mockGroups = [{ id: '1', name: 'Prod' }]
    ipc.override('list_connection_groups', () => mockGroups)
    const result = await listConnectionGroups()
    expect(result).toEqual(mockGroups)
  })
})

describe('updateConnectionGroup', () => {
  it('calls invoke with correct command and args', async () => {
    await updateConnectionGroup('grp-1', 'New Name')
    expect(ipc.calls('update_connection_group')).toEqual([
      {
        id: 'grp-1',
        name: 'New Name',
      },
    ])
  })

  it('propagates errors from invoke', async () => {
    ipc.override('update_connection_group', () => {
      throw new Error('Update group failed')
    })
    await expect(updateConnectionGroup('grp-1', 'Name')).rejects.toThrow('Update group failed')
  })
})

describe('deleteConnectionGroup', () => {
  it('calls invoke with correct command and args', async () => {
    await deleteConnectionGroup('grp-1')
    expect(ipc.calls('delete_connection_group')).toEqual([{ id: 'grp-1' }])
  })

  it('propagates errors from invoke', async () => {
    ipc.override('delete_connection_group', () => {
      throw new Error('Delete group failed')
    })
    await expect(deleteConnectionGroup('grp-1')).rejects.toThrow('Delete group failed')
  })
})

// --- MySQL connectivity ---

describe('testConnection', () => {
  it('calls invoke with correct command and only test-relevant fields', async () => {
    const mockResult = {
      success: true,
      serverVersion: '8.0.35',
      authMethod: 'mysql_native_password',
      sslStatus: 'Not using SSL',
      connectionTimeMs: 42,
      errorMessage: null,
    }
    ipc.override('test_connection', () => mockResult)
    const result = await testConnection(sampleFormData)

    expect(ipc.calls('test_connection')).toEqual([
      {
        input: {
          host: 'localhost',
          port: 3306,
          username: 'root',
          password: 'secret',
          profileId: null,
          defaultDatabase: 'mydb',
          sslEnabled: false,
          sslCaPath: null,
          sslCertPath: null,
          sslKeyPath: null,
          connectTimeoutSecs: 10,
        },
      },
    ])
    expect(result).toEqual(mockResult)
  })

  it('passes profileId so the backend can resolve the saved password', async () => {
    ipc.override('test_connection', () => ({ success: true }))
    await testConnection(sampleFormData, 'conn-42')

    const invokeArgs = ipc.calls('test_connection')[0] as { input: Record<string, unknown> }
    expect(invokeArgs.input.profileId).toBe('conn-42')
  })

  it('does not pass name, color, groupId, readOnly, or keepaliveIntervalSecs', async () => {
    ipc.override('test_connection', () => ({ success: true }))
    await testConnection(sampleFormData)

    const invokeArgs = ipc.calls('test_connection')[0] as { input: Record<string, unknown> }
    expect(invokeArgs.input).not.toHaveProperty('name')
    expect(invokeArgs.input).not.toHaveProperty('color')
    expect(invokeArgs.input).not.toHaveProperty('groupId')
    expect(invokeArgs.input).not.toHaveProperty('readOnly')
    expect(invokeArgs.input).not.toHaveProperty('keepaliveIntervalSecs')
  })

  it('propagates errors from invoke', async () => {
    ipc.override('test_connection', () => {
      throw new Error('Connection refused')
    })
    await expect(testConnection(sampleFormData)).rejects.toThrow('Connection refused')
  })
})

describe('openConnection', () => {
  it('calls invoke with profileId and returns sessionId', async () => {
    ipc.override('open_connection', () => ({ sessionId: 'sess-1', serverVersion: '8.0.35' }))
    const result = await openConnection('conn-1')
    expect(ipc.calls('open_connection')).toEqual([{ payload: { profileId: 'conn-1' } }])
    expect(result).toEqual({ sessionId: 'sess-1', serverVersion: '8.0.35' })
  })

  it('propagates errors from invoke', async () => {
    ipc.override('open_connection', () => {
      throw new Error('Connection failed')
    })
    await expect(openConnection('conn-1')).rejects.toThrow('Connection failed')
  })
})

describe('closeConnection', () => {
  it('calls invoke with correct command and connectionId arg', async () => {
    await closeConnection('conn-1')
    expect(ipc.calls('close_connection')).toEqual([{ connectionId: 'conn-1' }])
  })

  it('propagates errors from invoke', async () => {
    ipc.override('close_connection', () => {
      throw new Error('Not open')
    })
    await expect(closeConnection('conn-1')).rejects.toThrow('Not open')
  })
})

describe('getConnectionStatus', () => {
  it('calls invoke with correct command and connectionId arg', async () => {
    ipc.override('get_connection_status', () => 'connected')
    const result = await getConnectionStatus('conn-1')
    expect(ipc.calls('get_connection_status')).toEqual([{ connectionId: 'conn-1' }])
    expect(result).toBe('connected')
  })

  it('returns null when connection not found', async () => {
    ipc.override('get_connection_status', () => null)
    const result = await getConnectionStatus('unknown')
    expect(result).toBeNull()
  })

  it('propagates errors from invoke', async () => {
    ipc.override('get_connection_status', () => {
      throw new Error('Status error')
    })
    await expect(getConnectionStatus('conn-1')).rejects.toThrow('Status error')
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
