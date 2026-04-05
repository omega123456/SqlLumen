import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'
import {
  getObjectBody,
  saveObject,
  dropObject,
  getRoutineParameters,
  getRoutineParametersWithReturnType,
} from '../../lib/object-editor-commands'

const mockInvoke = vi.mocked(invoke)

beforeEach(() => {
  mockInvoke.mockReset()
})

describe('getObjectBody', () => {
  it('calls invoke with the correct command and args', async () => {
    mockInvoke.mockResolvedValue('CREATE VIEW ...')

    const result = await getObjectBody('conn-1', 'app_db', 'my_view', 'view')

    expect(mockInvoke).toHaveBeenCalledWith('get_object_body', {
      connectionId: 'conn-1',
      database: 'app_db',
      objectName: 'my_view',
      objectType: 'view',
    })
    expect(result).toBe('CREATE VIEW ...')
  })

  it('propagates invoke errors', async () => {
    mockInvoke.mockRejectedValue(new Error('Object not found'))
    await expect(getObjectBody('conn-1', 'db', 'x', 'procedure')).rejects.toThrow(
      'Object not found'
    )
  })
})

describe('saveObject', () => {
  it('calls invoke with the correct command and request shape', async () => {
    const response = {
      success: true,
      errorMessage: null,
      dropSucceeded: false,
      savedObjectName: 'my_proc',
    }
    mockInvoke.mockResolvedValue(response)

    const result = await saveObject(
      'conn-1',
      'app_db',
      'my_proc',
      'procedure',
      'CREATE PROCEDURE ...',
      'create'
    )

    expect(mockInvoke).toHaveBeenCalledWith('save_object', {
      request: {
        connectionId: 'conn-1',
        database: 'app_db',
        objectName: 'my_proc',
        objectType: 'procedure',
        body: 'CREATE PROCEDURE ...',
        mode: 'create',
      },
    })
    expect(result).toEqual(response)
  })

  it('propagates invoke errors', async () => {
    mockInvoke.mockRejectedValue(new Error('Save failed'))
    await expect(saveObject('conn-1', 'db', 'x', 'view', 'body', 'alter')).rejects.toThrow(
      'Save failed'
    )
  })
})

describe('dropObject', () => {
  it('calls invoke with the correct command and args', async () => {
    mockInvoke.mockResolvedValue(undefined)

    const result = await dropObject('conn-1', 'app_db', 'my_trigger', 'trigger')

    expect(mockInvoke).toHaveBeenCalledWith('drop_object', {
      connectionId: 'conn-1',
      database: 'app_db',
      objectName: 'my_trigger',
      objectType: 'trigger',
    })
    expect(result).toBeUndefined()
  })

  it('propagates invoke errors', async () => {
    mockInvoke.mockRejectedValue(new Error('Drop failed'))
    await expect(dropObject('conn-1', 'db', 'x', 'event')).rejects.toThrow('Drop failed')
  })
})

describe('getRoutineParameters', () => {
  it('calls invoke with the correct command and args', async () => {
    const params = [
      { name: 'p1', dataType: 'INT', mode: 'IN', ordinalPosition: 1 },
      { name: 'p2', dataType: 'VARCHAR(255)', mode: 'OUT', ordinalPosition: 2 },
    ]
    mockInvoke.mockResolvedValue(params)

    const result = await getRoutineParameters('conn-1', 'app_db', 'my_proc', 'procedure')

    expect(mockInvoke).toHaveBeenCalledWith('get_routine_parameters', {
      connectionId: 'conn-1',
      database: 'app_db',
      routineName: 'my_proc',
      routineType: 'procedure',
    })
    expect(result).toEqual(params)
  })

  it('works with function routine type', async () => {
    mockInvoke.mockResolvedValue([])

    await getRoutineParameters('conn-1', 'db', 'my_func', 'function')

    expect(mockInvoke).toHaveBeenCalledWith('get_routine_parameters', {
      connectionId: 'conn-1',
      database: 'db',
      routineName: 'my_func',
      routineType: 'function',
    })
  })

  it('propagates invoke errors', async () => {
    mockInvoke.mockRejectedValue(new Error('Not found'))
    await expect(getRoutineParameters('conn-1', 'db', 'x', 'procedure')).rejects.toThrow(
      'Not found'
    )
  })
})

describe('getRoutineParametersWithReturnType', () => {
  it('calls invoke with the correct command and args', async () => {
    const params = [
      { name: '', dataType: 'int', mode: '', ordinalPosition: 0 },
      { name: 'p1', dataType: 'INT', mode: 'IN', ordinalPosition: 1 },
    ]
    mockInvoke.mockResolvedValue(params)

    const result = await getRoutineParametersWithReturnType(
      'conn-1',
      'app_db',
      'my_func',
      'FUNCTION'
    )

    expect(mockInvoke).toHaveBeenCalledWith('get_routine_parameters_with_return_type', {
      connectionId: 'conn-1',
      database: 'app_db',
      routineName: 'my_func',
      routineType: 'FUNCTION',
    })
    expect(result).toEqual(params)
  })

  it('propagates invoke errors', async () => {
    mockInvoke.mockRejectedValue(new Error('Connection lost'))
    await expect(
      getRoutineParametersWithReturnType('conn-1', 'db', 'x', 'FUNCTION')
    ).rejects.toThrow('Connection lost')
  })
})
