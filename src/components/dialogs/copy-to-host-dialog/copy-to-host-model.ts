import type { DropdownOption } from '../../common/Dropdown'
import {
  COPY_OBJECT_CATEGORY_LABELS,
  COPY_OBJECT_CATEGORY_ORDER,
  type CopyInsertMode,
  type CopyObjectCategory,
  type CopyObjectSelection,
  type CopyProgress,
  type CopyToHostOptions,
} from '../../../lib/copy-to-host-commands'
import { isPlaywrightBuild } from '../../../lib/tauri-env'

export const skipFocusManagement = isPlaywrightBuild() || import.meta.env.VITEST === true

export const NEW_DB_SENTINEL = '__new__'

export type CopyType = 'both' | 'structureOnly' | 'dataOnly'

export const CATEGORY_LABELS = COPY_OBJECT_CATEGORY_LABELS
export const CATEGORY_ORDER = COPY_OBJECT_CATEGORY_ORDER

export const COPY_TYPE_OPTIONS: DropdownOption<CopyType>[] = [
  { value: 'both', label: 'Structure + data' },
  { value: 'structureOnly', label: 'Structure only' },
  { value: 'dataOnly', label: 'Data only' },
]

export const INSERT_MODE_OPTIONS: DropdownOption<CopyInsertMode>[] = [
  { value: 'insert', label: 'INSERT' },
  { value: 'insertIgnore', label: 'INSERT IGNORE' },
  { value: 'replace', label: 'REPLACE INTO' },
]

export function normalizeHost(host: string | null | undefined): string | null {
  const normalized = host?.trim().toLowerCase()
  return normalized ? normalized : null
}

export function isOutsideSourceHost(host: string, sourceHost: string | null): boolean {
  return sourceHost === null || normalizeHost(host) !== sourceHost
}

export interface CopyToHostDialogProps {
  isOpen: boolean
  onClose: () => void
  sourceConnectionId: string
  sourceConnectionLabel: string
  sourceDatabase: string
  preSelectedObject?: CopyObjectSelection
}

export interface CopyDialogOptions {
  copyType: CopyType
  dropIfExists: boolean
  createIfNotExists: boolean
  insertMode: CopyInsertMode
  truncateBeforeInsert: boolean
  ignoreDefiner: boolean
}

export const DEFAULT_COPY_OPTIONS: CopyDialogOptions = {
  copyType: 'both',
  dropIfExists: true,
  createIfNotExists: true,
  insertMode: 'insert',
  truncateBeforeInsert: false,
  ignoreDefiner: true,
}

export type UpdateCopyOption = <Key extends keyof CopyDialogOptions>(
  key: Key,
  value: CopyDialogOptions[Key]
) => void

export function toCopyToHostOptions(options: CopyDialogOptions): CopyToHostOptions {
  return {
    copyStructure: options.copyType !== 'dataOnly',
    copyData: options.copyType !== 'structureOnly',
    dropIfExists: options.dropIfExists,
    createIfNotExists: options.createIfNotExists,
    truncateBeforeInsert: options.truncateBeforeInsert,
    insertMode: options.insertMode,
    ignoreDefiner: options.ignoreDefiner,
  }
}

interface PreselectionKey {
  category: CopyObjectCategory | null
  name: string | null
}

export function preselectionKey(
  preSelectedObject: CopyObjectSelection | undefined
): PreselectionKey {
  if (!preSelectedObject) return { category: null, name: null }
  return { category: preSelectedObject.category, name: preSelectedObject.name }
}

export function objectCountText(count: number): string {
  return `${count} ${count === 1 ? 'object' : 'objects'}`
}

export function objectsSectionTitle(selectedCount: number): string {
  if (selectedCount === 0) return 'Objects'
  return `Objects (${selectedCount})`
}

interface CopyReadinessInputs {
  targetConnectionId: string
  targetDatabase: string
  selectedCount: number
  isCopying: boolean
}

export function canStartCopy(inputs: CopyReadinessInputs): boolean {
  if (!inputs.targetConnectionId) return false
  if (!inputs.targetDatabase) return false
  return inputs.selectedCount > 0 && !inputs.isCopying
}

export interface TargetSelection {
  connectionId: string
  databaseValue: string
  newDatabaseName: string
}

export const EMPTY_TARGET_SELECTION: TargetSelection = {
  connectionId: '',
  databaseValue: '',
  newDatabaseName: '',
}

export function withDefaultDatabase(selection: TargetSelection, database: string): TargetSelection {
  if (selection.databaseValue !== '') return selection
  return { ...selection, databaseValue: database }
}

export interface TargetDatabaseListing {
  databases: string[]
  notice: string | null
}

export const EMPTY_TARGET_LISTING: TargetDatabaseListing = { databases: [], notice: null }

export const CLOSED_TARGET_NOTICE =
  'Open this target connection first to list existing databases, or choose “+ New database…”.'

export interface CopyRunState {
  isCopying: boolean
  jobId: string | null
  progress: CopyProgress | null
  cancelPending: boolean
}

export const IDLE_COPY_RUN: CopyRunState = {
  isCopying: false,
  jobId: null,
  progress: null,
  cancelPending: false,
}

export function draftKeyFor(props: CopyToHostDialogProps): string {
  const preSelectedCategory = props.preSelectedObject?.category ?? ''
  return `${props.isOpen}:${preSelectedCategory}`
}
