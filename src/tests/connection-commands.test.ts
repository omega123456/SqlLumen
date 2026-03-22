import { describe, it, expect, vi, beforeEach } from 'vitest'
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
} from '../lib/connection-commands'
import type { ConnectionFormData } from '../types/connection'

// Mock the @tauri-apps/api/core module
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'
const mockInvoke = vi.mocked(invoke)

beforeEach(() => {
  mockInvoke.mockReset()
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
    mockInvoke.mockResolvedValue('new-uuid-123')
    const result = await saveConnection(sampleFormData)
    expect(mockInvoke).toHaveBeenCalledWith('save_connection', {
      data: {
        ...sampleFormData,
        password: 'secret',
        sortOrder: 0,
      },
    })
    expect(result).toBe('new-uuid-123')
  })

  it('converts empty password to null', async () => {
    mockInvoke.mockResolvedValue('new-uuid-456')
    await saveConnection({ ...sampleFormData, password: '' })
    expect(mockInvoke).toHaveBeenCalledWith('save_connection', {
      data: expect.objectContaining({ password: null }),
    })
  })

  it('propagates errors from invoke', async () => {
    mockInvoke.mockRejectedValue(new Error('Save failed'))
    await expect(saveConnection(sampleFormData)).rejects.toThrow('Save failed')
  })
})

describe('getConnection', () => {
  it('calls invoke with correct command and args', async () => {
    const mockConnection = { id: 'abc', name: 'Test' }
    mockInvoke.mockResolvedValue(mockConnection)
    const result = await getConnection('abc')
    expect(mockInvoke).toHaveBeenCalledWith('get_connection', { id: 'abc' })
    expect(result).toEqual(mockConnection)
  })

  it('propagates errors from invoke', async () => {
    mockInvoke.mockRejectedValue(new Error('Not found'))
    await expect(getConnection('missing')).rejects.toThrow('Not found')
  })
})

describe('listConnections', () => {
  it('calls invoke with correct command name', async () => {
    mockInvoke.mockResolvedValue([])
    const result = await listConnections()
    expect(mockInvoke).toHaveBeenCalledWith('list_connections')
    expect(result).toEqual([])
  })

  it('returns array of connections', async () => {
    const mockList = [
      { id: '1', name: 'A' },
      { id: '2', name: 'B' },
    ]
    mockInvoke.mockResolvedValue(mockList)
    const result = await listConnections()
    expect(result).toEqual(mockList)
  })
})

describe('updateConnection', () => {
  it('calls invoke with correct command and args', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await updateConnection('abc', sampleFormData)
    expect(mockInvoke).toHaveBeenCalledWith('update_connection', {
      id: 'abc',
      data: {
        ...sampleFormData,
        password: 'secret',
        clearPassword: false,
        sortOrder: 0,
      },
    })
  })

  it('converts empty password to null for update', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await updateConnection('abc', { ...sampleFormData, password: '' })
    expect(mockInvoke).toHaveBeenCalledWith('update_connection', {
      id: 'abc',
      data: expect.objectContaining({ password: null, clearPassword: false }),
    })
  })

  it('passes clearPassword when requested', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await updateConnection('abc', { ...sampleFormData, password: '' }, { clearPassword: true })
    expect(mockInvoke).toHaveBeenCalledWith('update_connection', {
      id: 'abc',
      data: expect.objectContaining({ password: null, clearPassword: true }),
    })
  })

  it('propagates errors from invoke', async () => {
    mockInvoke.mockRejectedValue(new Error('Update failed'))
    await expect(updateConnection('abc', sampleFormData)).rejects.toThrow('Update failed')
  })
})

describe('deleteConnection', () => {
  it('calls invoke with correct command and args', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await deleteConnection('abc')
    expect(mockInvoke).toHaveBeenCalledWith('delete_connection', { id: 'abc' })
  })

  it('propagates errors from invoke', async () => {
    mockInvoke.mockRejectedValue(new Error('Delete failed'))
    await expect(deleteConnection('abc')).rejects.toThrow('Delete failed')
  })
})

// --- Group CRUD ---

describe('createConnectionGroup', () => {
  it('calls invoke with correct command and args', async () => {
    mockInvoke.mockResolvedValue('group-uuid-123')
    const result = await createConnectionGroup('Production')
    expect(mockInvoke).toHaveBeenCalledWith('create_connection_group', { name: 'Production' })
    expect(result).toBe('group-uuid-123')
  })

  it('propagates errors from invoke', async () => {
    mockInvoke.mockRejectedValue(new Error('Create group failed'))
    await expect(createConnectionGroup('Prod')).rejects.toThrow('Create group failed')
  })
})

describe('listConnectionGroups', () => {
  it('calls invoke with correct command name', async () => {
    mockInvoke.mockResolvedValue([])
    const result = await listConnectionGroups()
    expect(mockInvoke).toHaveBeenCalledWith('list_connection_groups')
    expect(result).toEqual([])
  })

  it('returns array of groups', async () => {
    const mockGroups = [{ id: '1', name: 'Prod' }]
    mockInvoke.mockResolvedValue(mockGroups)
    const result = await listConnectionGroups()
    expect(result).toEqual(mockGroups)
  })
})

describe('updateConnectionGroup', () => {
  it('calls invoke with correct command and args', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await updateConnectionGroup('grp-1', 'New Name')
    expect(mockInvoke).toHaveBeenCalledWith('update_connection_group', {
      id: 'grp-1',
      name: 'New Name',
    })
  })

  it('propagates errors from invoke', async () => {
    mockInvoke.mockRejectedValue(new Error('Update group failed'))
    await expect(updateConnectionGroup('grp-1', 'Name')).rejects.toThrow('Update group failed')
  })
})

describe('deleteConnectionGroup', () => {
  it('calls invoke with correct command and args', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await deleteConnectionGroup('grp-1')
    expect(mockInvoke).toHaveBeenCalledWith('delete_connection_group', { id: 'grp-1' })
  })

  it('propagates errors from invoke', async () => {
    mockInvoke.mockRejectedValue(new Error('Delete group failed'))
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
    mockInvoke.mockResolvedValue(mockResult)
    const result = await testConnection(sampleFormData)

    expect(mockInvoke).toHaveBeenCalledWith('test_connection', {
      input: {
        host: 'localhost',
        port: 3306,
        username: 'root',
        password: 'secret',
        defaultDatabase: 'mydb',
        sslEnabled: false,
        sslCaPath: null,
        sslCertPath: null,
        sslKeyPath: null,
        connectTimeoutSecs: 10,
      },
    })
    expect(result).toEqual(mockResult)
  })

  it('does not pass name, color, groupId, readOnly, or keepaliveIntervalSecs', async () => {
    mockInvoke.mockResolvedValue({ success: true })
    await testConnection(sampleFormData)

    const invokeArgs = mockInvoke.mock.calls[0][1] as { input: Record<string, unknown> }
    expect(invokeArgs.input).not.toHaveProperty('name')
    expect(invokeArgs.input).not.toHaveProperty('color')
    expect(invokeArgs.input).not.toHaveProperty('groupId')
    expect(invokeArgs.input).not.toHaveProperty('readOnly')
    expect(invokeArgs.input).not.toHaveProperty('keepaliveIntervalSecs')
  })

  it('propagates errors from invoke', async () => {
    mockInvoke.mockRejectedValue(new Error('Connection refused'))
    await expect(testConnection(sampleFormData)).rejects.toThrow('Connection refused')
  })
})

describe('openConnection', () => {
  it('calls invoke with profileId and returns sessionId', async () => {
    mockInvoke.mockResolvedValue({ sessionId: 'sess-1', serverVersion: '8.0.35' })
    const result = await openConnection('conn-1')
    expect(mockInvoke).toHaveBeenCalledWith('open_connection', { payload: { profileId: 'conn-1' } })
    expect(result).toEqual({ sessionId: 'sess-1', serverVersion: '8.0.35' })
  })

  it('propagates errors from invoke', async () => {
    mockInvoke.mockRejectedValue(new Error('Connection failed'))
    await expect(openConnection('conn-1')).rejects.toThrow('Connection failed')
  })
})

describe('closeConnection', () => {
  it('calls invoke with correct command and connectionId arg', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await closeConnection('conn-1')
    expect(mockInvoke).toHaveBeenCalledWith('close_connection', { connectionId: 'conn-1' })
  })

  it('propagates errors from invoke', async () => {
    mockInvoke.mockRejectedValue(new Error('Not open'))
    await expect(closeConnection('conn-1')).rejects.toThrow('Not open')
  })
})

describe('getConnectionStatus', () => {
  it('calls invoke with correct command and connectionId arg', async () => {
    mockInvoke.mockResolvedValue('connected')
    const result = await getConnectionStatus('conn-1')
    expect(mockInvoke).toHaveBeenCalledWith('get_connection_status', { connectionId: 'conn-1' })
    expect(result).toBe('connected')
  })

  it('returns null when connection not found', async () => {
    mockInvoke.mockResolvedValue(null)
    const result = await getConnectionStatus('unknown')
    expect(result).toBeNull()
  })

  it('propagates errors from invoke', async () => {
    mockInvoke.mockRejectedValue(new Error('Status error'))
    await expect(getConnectionStatus('conn-1')).rejects.toThrow('Status error')
  })
})
