import type { EditableObjectType, RoutineParameter, SaveObjectResponse } from '../types/schema'
import { invokeArgumentCommand, invokeCommand } from './ipc/dispatch'
import type {
  EditableObjectRequest,
  RoutineRequest,
  RoutineWithReturnTypeRequest,
} from './ipc/requests'

export interface SaveObjectRequest {
  connectionId: string
  database: string
  objectName: string
  objectType: EditableObjectType
  body: string
  mode: 'create' | 'alter'
}

export interface RoutineParametersWithFoundResponse {
  parameters: RoutineParameter[]
  found: boolean
}

export async function getObjectBody(request: EditableObjectRequest): Promise<string> {
  return invokeCommand({ command: 'get_object_body', payload: request })
}

export async function saveObject(request: SaveObjectRequest): Promise<SaveObjectResponse> {
  return invokeArgumentCommand({ command: 'save_object', argument: { request } })
}

export async function dropObject(request: EditableObjectRequest): Promise<void> {
  return invokeCommand({ command: 'drop_object', payload: request })
}

export async function getRoutineParameters(request: RoutineRequest): Promise<RoutineParameter[]> {
  return invokeCommand({ command: 'get_routine_parameters', payload: request })
}

export async function getRoutineParametersWithReturnType(
  request: RoutineWithReturnTypeRequest
): Promise<RoutineParametersWithFoundResponse> {
  return invokeCommand({ command: 'get_routine_parameters_with_return_type', payload: request })
}
