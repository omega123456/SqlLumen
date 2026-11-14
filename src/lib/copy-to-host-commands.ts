import { invokeArgumentCommand, invokeCommand } from './ipc/dispatch'
import type { JobStatus } from './job-progress'

export interface CopyableTable {
  name: string
  estimatedRows: number
}

export interface CopyableObjects {
  tables: CopyableTable[]
  procedures: string[]
  functions: string[]
  triggers: string[]
  events: string[]
}

export type CopyInsertMode = 'insert' | 'insertIgnore' | 'replace'

export type CopyObjectCategory = 'tables' | 'procedures' | 'functions' | 'triggers' | 'events'

export interface CopyObjectSelection {
  category: CopyObjectCategory
  name: string
}

export const COPY_OBJECT_CATEGORY_LABELS: Record<CopyObjectCategory, string> = {
  tables: 'Tables',
  procedures: 'Procedures',
  functions: 'Functions',
  triggers: 'Triggers',
  events: 'Events',
}

export const COPY_OBJECT_CATEGORY_ORDER: CopyObjectCategory[] = [
  'tables',
  'procedures',
  'functions',
  'triggers',
  'events',
]

export type CopyToHostObjects = Record<CopyObjectCategory, string[]>

export type CopySelectionState = Record<CopyObjectCategory, Set<string>>

export function createEmptyCopySelection(): CopySelectionState {
  return {
    tables: new Set(),
    procedures: new Set(),
    functions: new Set(),
    triggers: new Set(),
    events: new Set(),
  }
}

export function countCopySelection(selected: CopySelectionState): number {
  return COPY_OBJECT_CATEGORY_ORDER.reduce((sum, category) => sum + selected[category].size, 0)
}

export function assembleCopyObjects(selected: CopySelectionState): CopyToHostObjects {
  return {
    tables: [...selected.tables],
    procedures: [...selected.procedures],
    functions: [...selected.functions],
    triggers: [...selected.triggers],
    events: [...selected.events],
  }
}

export interface CopyToHostObjectsShape {
  tables: string[]
  procedures: string[]
  functions: string[]
  triggers: string[]
  events: string[]
}

export interface CopyToHostOptions {
  copyStructure: boolean
  copyData: boolean
  dropIfExists: boolean
  createIfNotExists: boolean
  truncateBeforeInsert: boolean
  insertMode: CopyInsertMode
  ignoreDefiner: boolean
}

export interface CopyToHostParams {
  sourceConnectionId: string
  sourceDatabase: string
  targetConnectionId: string
  targetDatabase: string
  objects: CopyToHostObjects
  options: CopyToHostOptions
}

export function sanitizeCopyToHostParams(params: CopyToHostParams): CopyToHostParams {
  return params
}

export type CopyJobStatus = JobStatus

export interface CopyProgress {
  jobId: string
  status: CopyJobStatus
  objectsTotal: number
  objectsDone: number
  currentObject: string | null
  currentObjectType: string | null
  rowsTotal: number | null
  rowsDone: number | null
  errorMessage: string | null
  cancelRequested: boolean
}

export async function listCopyableObjects(
  connectionId: string,
  database: string
): Promise<CopyableObjects> {
  return invokeCommand({ command: 'list_copyable_objects', payload: { connectionId, database } })
}

export async function startCopyToHost(params: CopyToHostParams): Promise<string> {
  return invokeArgumentCommand({
    command: 'start_copy_to_host',
    argument: { params: sanitizeCopyToHostParams(params) },
  })
}

export async function getCopyProgress(jobId: string): Promise<CopyProgress> {
  return invokeArgumentCommand({ command: 'get_copy_progress', argument: { jobId } })
}

export async function cancelCopy(jobId: string): Promise<void> {
  return invokeArgumentCommand({ command: 'cancel_copy', argument: { jobId } })
}
