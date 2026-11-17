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

    const result = await getObjectBody({
      connectionId: 'conn-1',
      database: 'app_db',
      objectName: 'my_view',
      objectType: 'view',
    })

    expect(ipc.payloads('get_object_body')).toEqual([
      {
        connectionId: 'conn-1',
        database: 'app_db',
        objectName: 'my_view',
        objectType: 'view',
      },
    ])
    expect(result).toBe('CREATE VIEW ...')
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

    const result = await saveObject({
      connectionId: 'conn-1',
      database: 'app_db',
      objectName: 'my_proc',
      objectType: 'procedure',
      body: 'CREATE PROCEDURE ...',
      mode: 'create',
    })

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
})

describe('dropObject', () => {
  it('calls invoke with the correct command and args', async () => {
    const result = await dropObject({
      connectionId: 'conn-1',
      database: 'app_db',
      objectName: 'my_trigger',
      objectType: 'trigger',
    })

    expect(ipc.payloads('drop_object')).toEqual([
      {
        connectionId: 'conn-1',
        database: 'app_db',
        objectName: 'my_trigger',
        objectType: 'trigger',
      },
    ])
    expect(result).toBeUndefined()
  })
})

describe('getRoutineParameters', () => {
  it('calls invoke with the correct command and args', async () => {
    const params = [
      { name: 'p1', dataType: 'INT', mode: 'IN', ordinalPosition: 1 },
      { name: 'p2', dataType: 'VARCHAR(255)', mode: 'OUT', ordinalPosition: 2 },
    ]
    ipc.override('get_routine_parameters', () => params)

    const result = await getRoutineParameters({
      connectionId: 'conn-1',
      database: 'app_db',
      routineName: 'my_proc',
      routineType: 'procedure',
    })

    expect(ipc.payloads('get_routine_parameters')).toEqual([
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
    await getRoutineParameters({
      connectionId: 'conn-1',
      database: 'db',
      routineName: 'my_func',
      routineType: 'function',
    })

    expect(ipc.payloads('get_routine_parameters')).toEqual([
      {
        connectionId: 'conn-1',
        database: 'db',
        routineName: 'my_func',
        routineType: 'function',
      },
    ])
  })
})

describe('getRoutineParametersWithReturnType', () => {
  it('calls invoke with the correct command and args', async () => {
    const params = [
      { name: '', dataType: 'int', mode: '', ordinalPosition: 0 },
      { name: 'p1', dataType: 'INT', mode: 'IN', ordinalPosition: 1 },
    ]
    ipc.override('get_routine_parameters_with_return_type', () => params)

    const result = await getRoutineParametersWithReturnType({
      connectionId: 'conn-1',
      database: 'app_db',
      routineName: 'my_func',
      routineType: 'FUNCTION',
    })

    expect(ipc.payloads('get_routine_parameters_with_return_type')).toEqual([
      {
        connectionId: 'conn-1',
        database: 'app_db',
        routineName: 'my_func',
        routineType: 'FUNCTION',
      },
    ])
    expect(result).toEqual(params)
  })
})
