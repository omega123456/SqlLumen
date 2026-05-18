import { describe, expect, it } from 'vitest'

import { ipc } from '../ipc-mock'
import {
  getObjectBody,
  saveObject,
  dropObject,
  getRoutineParameters,
  getRoutineParametersWithReturnType,
} from '../../lib/object-editor-commands'

describe('getObjectBody', () => {
  it('calls invoke with the correct command and args', async () => {
    ipc.override('get_object_body', () => 'CREATE VIEW ...')

    const result = await getObjectBody('conn-1', 'app_db', 'my_view', 'view')

    expect(ipc.calls('get_object_body')).toEqual([
      {
        connectionId: 'conn-1',
        database: 'app_db',
        objectName: 'my_view',
        objectType: 'view',
      },
    ])
    expect(result).toBe('CREATE VIEW ...')
  })

  it('propagates invoke errors', async () => {
    ipc.override('get_object_body', () => {
      throw new Error('Object not found')
    })
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
    ipc.override('save_object', () => response)

    const result = await saveObject(
      'conn-1',
      'app_db',
      'my_proc',
      'procedure',
      'CREATE PROCEDURE ...',
      'create'
    )

    expect(ipc.calls('save_object')).toEqual([
      {
        request: {
          connectionId: 'conn-1',
          database: 'app_db',
          objectName: 'my_proc',
          objectType: 'procedure',
          body: 'CREATE PROCEDURE ...',
          mode: 'create',
        },
      },
    ])
    expect(result).toEqual(response)
  })

  it('propagates invoke errors', async () => {
    ipc.override('save_object', () => {
      throw new Error('Save failed')
    })
    await expect(saveObject('conn-1', 'db', 'x', 'view', 'body', 'alter')).rejects.toThrow(
      'Save failed'
    )
  })
})

describe('dropObject', () => {
  it('calls invoke with the correct command and args', async () => {
    const result = await dropObject('conn-1', 'app_db', 'my_trigger', 'trigger')

    expect(ipc.calls('drop_object')).toEqual([
      {
        connectionId: 'conn-1',
        database: 'app_db',
        objectName: 'my_trigger',
        objectType: 'trigger',
      },
    ])
    expect(result).toBeUndefined()
  })

  it('propagates invoke errors', async () => {
    ipc.override('drop_object', () => {
      throw new Error('Drop failed')
    })
    await expect(dropObject('conn-1', 'db', 'x', 'event')).rejects.toThrow('Drop failed')
  })
})

describe('getRoutineParameters', () => {
  it('calls invoke with the correct command and args', async () => {
    const params = [
      { name: 'p1', dataType: 'INT', mode: 'IN', ordinalPosition: 1 },
      { name: 'p2', dataType: 'VARCHAR(255)', mode: 'OUT', ordinalPosition: 2 },
    ]
    ipc.override('get_routine_parameters', () => params)

    const result = await getRoutineParameters('conn-1', 'app_db', 'my_proc', 'procedure')

    expect(ipc.calls('get_routine_parameters')).toEqual([
      {
        connectionId: 'conn-1',
        database: 'app_db',
        routineName: 'my_proc',
        routineType: 'procedure',
      },
    ])
    expect(result).toEqual(params)
  })

  it('works with function routine type', async () => {
    await getRoutineParameters('conn-1', 'db', 'my_func', 'function')

    expect(ipc.calls('get_routine_parameters')).toEqual([
      {
        connectionId: 'conn-1',
        database: 'db',
        routineName: 'my_func',
        routineType: 'function',
      },
    ])
  })

  it('propagates invoke errors', async () => {
    ipc.override('get_routine_parameters', () => {
      throw new Error('Not found')
    })
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
    ipc.override('get_routine_parameters_with_return_type', () => params)

    const result = await getRoutineParametersWithReturnType(
      'conn-1',
      'app_db',
      'my_func',
      'FUNCTION'
    )

    expect(ipc.calls('get_routine_parameters_with_return_type')).toEqual([
      {
        connectionId: 'conn-1',
        database: 'app_db',
        routineName: 'my_func',
        routineType: 'FUNCTION',
      },
    ])
    expect(result).toEqual(params)
  })

  it('propagates invoke errors', async () => {
    ipc.override('get_routine_parameters_with_return_type', () => {
      throw new Error('Connection lost')
    })
    await expect(
      getRoutineParametersWithReturnType('conn-1', 'db', 'x', 'FUNCTION')
    ).rejects.toThrow('Connection lost')
  })
})
