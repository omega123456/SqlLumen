import type { EditableObjectType, ObjectType } from '../../types/schema'

export interface ConnectionTabRequest {
  connectionId: string
  tabId: string
}

export interface DatabaseRequest {
  connectionId: string
  database: string
}

export interface TableRequest {
  connectionId: string
  database: string
  table: string
}

export interface SchemaObjectRequest {
  connectionId: string
  database: string
  objectName: string
  objectType: ObjectType
}

export interface EditableObjectRequest extends SchemaObjectRequest {
  objectType: EditableObjectType
}

export interface RoutineRequest {
  connectionId: string
  database: string
  routineName: string
  routineType: 'procedure' | 'function'
}

export interface RoutineWithReturnTypeRequest {
  connectionId: string
  database: string
  routineName: string
  routineType: 'FUNCTION' | 'PROCEDURE'
}

export interface FileContentRequest {
  path: string
  content: string
}

export interface ResultSlotRequest {
  connectionId: string
  tabId: string
  resultIndex: number
  queryId: string
}
