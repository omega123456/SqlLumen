import { invoke } from '@tauri-apps/api/core'

/** A table available to copy, with an estimated row count. */
export interface CopyableTable {
  name: string
  estimatedRows: number
}

/** The copyable objects of a source database, grouped by category. */
export interface CopyableObjects {
  tables: CopyableTable[]
  procedures: string[]
  functions: string[]
  triggers: string[]
  events: string[]
}

/** The closed set of supported data insert modes. */
export type CopyInsertMode = 'insert' | 'insertIgnore' | 'replace'

/** The five copyable object selection categories. */
export type CopyObjectCategory = 'tables' | 'procedures' | 'functions' | 'triggers' | 'events'

/** A single pre-selected copy object. */
export interface CopyObjectSelection {
  category: CopyObjectCategory
  name: string
}

/** Stable copy category display metadata shared by copy-to-host UI surfaces. */
export const COPY_OBJECT_CATEGORY_LABELS: Record<CopyObjectCategory, string> = {
  tables: 'Tables',
  procedures: 'Procedures',
  functions: 'Functions',
  triggers: 'Triggers',
  events: 'Events',
}

/** Stable category order used by copy-to-host selection UI. */
export const COPY_OBJECT_CATEGORY_ORDER: CopyObjectCategory[] = [
  'tables',
  'procedures',
  'functions',
  'triggers',
  'events',
]

/** The set of source objects selected for copying, grouped by category. */
export type CopyToHostObjects = Record<CopyObjectCategory, string[]>

/** Internal selection state used by the copy-to-host UI. */
export type CopySelectionState = Record<CopyObjectCategory, Set<string>>

/** Create an empty copy-to-host selection state. */
export function createEmptyCopySelection(): CopySelectionState {
  return {
    tables: new Set(),
    procedures: new Set(),
    functions: new Set(),
    triggers: new Set(),
    events: new Set(),
  }
}

/** Count selected objects across all copy categories. */
export function countCopySelection(selected: CopySelectionState): number {
  return COPY_OBJECT_CATEGORY_ORDER.reduce((sum, category) => sum + selected[category].size, 0)
}

/** Convert UI Set-based selection state into IPC-friendly arrays. */
export function assembleCopyObjects(selected: CopySelectionState): CopyToHostObjects {
  return {
    tables: [...selected.tables],
    procedures: [...selected.procedures],
    functions: [...selected.functions],
    triggers: [...selected.triggers],
    events: [...selected.events],
  }
}

/* Stable expanded shape for IPC documentation/reference. */
export interface CopyToHostObjectsShape {
  tables: string[]
  procedures: string[]
  functions: string[]
  triggers: string[]
  events: string[]
}

/** Options controlling how objects are copied to the target host. */
export interface CopyToHostOptions {
  copyStructure: boolean
  copyData: boolean
  dropIfExists: boolean
  createIfNotExists: boolean
  truncateBeforeInsert: boolean
  insertMode: CopyInsertMode
  ignoreDefiner: boolean
}

/** Input for starting a copy-to-host job. */
export interface CopyToHostParams {
  sourceConnectionId: string
  sourceDatabase: string
  /** Saved profile id of the target connection. */
  targetConnectionId: string
  targetDatabase: string
  objects: CopyToHostObjects
  options: CopyToHostOptions
}

/** Normalize params before invoking the backend. */
export function sanitizeCopyToHostParams(params: CopyToHostParams): CopyToHostParams {
  return params
}

/** Status of a copy-to-host job. */
export type CopyJobStatus = 'running' | 'completed' | 'failed' | 'cancelled'

/** Progress info for an active or completed copy-to-host job. */
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

/** List the copyable objects (tables, procedures, functions, triggers, events) of a source database. */
export async function listCopyableObjects(
  connectionId: string,
  database: string
): Promise<CopyableObjects> {
  return invoke<CopyableObjects>('list_copyable_objects', { connectionId, database })
}

/** Start a copy-to-host job. Returns the job ID for progress tracking. */
export async function startCopyToHost(params: CopyToHostParams): Promise<string> {
  return invoke<string>('start_copy_to_host', { params: sanitizeCopyToHostParams(params) })
}

/** Get progress of a copy-to-host job. */
export async function getCopyProgress(jobId: string): Promise<CopyProgress> {
  return invoke<CopyProgress>('get_copy_progress', { jobId })
}

/** Cancel a running copy-to-host job. */
export async function cancelCopy(jobId: string): Promise<void> {
  return invoke<void>('cancel_copy', { jobId })
}
