/**
 * Typed IPC wrappers for object-editor Tauri commands.
 */

import { invoke } from '@tauri-apps/api/core'
import type { EditableObjectType, RoutineParameter, SaveObjectResponse } from '../types/schema'

export async function getObjectBody(
  connectionId: string,
  database: string,
  objectName: string,
  objectType: EditableObjectType
): Promise<string> {
  return invoke<string>('get_object_body', {
    connectionId,
    database,
    objectName,
    objectType,
  })
}

export async function saveObject(
  connectionId: string,
  database: string,
  objectName: string,
  objectType: EditableObjectType,
  body: string,
  mode: 'create' | 'alter'
): Promise<SaveObjectResponse> {
  return invoke<SaveObjectResponse>('save_object', {
    request: {
      connectionId,
      database,
      objectName,
      objectType,
      body,
      mode,
    },
  })
}

export async function dropObject(
  connectionId: string,
  database: string,
  objectName: string,
  objectType: EditableObjectType
): Promise<void> {
  return invoke<void>('drop_object', {
    connectionId,
    database,
    objectName,
    objectType,
  })
}

export async function getRoutineParameters(
  connectionId: string,
  database: string,
  routineName: string,
  routineType: 'procedure' | 'function'
): Promise<RoutineParameter[]> {
  return invoke<RoutineParameter[]>('get_routine_parameters', {
    connectionId,
    database,
    routineName,
    routineType,
  })
}

/** Response from get_routine_parameters_with_return_type — includes `found` flag. */
export interface RoutineParametersWithFoundResponse {
  parameters: RoutineParameter[]
  found: boolean
}

export async function getRoutineParametersWithReturnType(
  connectionId: string,
  database: string,
  routineName: string,
  routineType: 'FUNCTION' | 'PROCEDURE'
): Promise<RoutineParametersWithFoundResponse> {
  return invoke<RoutineParametersWithFoundResponse>('get_routine_parameters_with_return_type', {
    connectionId,
    database,
    routineName,
    routineType,
  })
}
