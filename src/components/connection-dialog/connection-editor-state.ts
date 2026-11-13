import { useSettingsStore } from '../../stores/settings-store'
import type {
  ConnectionFormData,
  SavedConnection,
  TestConnectionResult,
} from '../../types/connection'
import { toErrorMessage } from '../../lib/error-message'
import { isBlank } from '../../lib/value-checks'
import { withoutKey } from '../../lib/record-utils'

export const DEFAULT_CONNECT_TIMEOUT_SECONDS = 10
export const DEFAULT_KEEPALIVE_INTERVAL_SECONDS = 60
const DEFAULT_MYSQL_PORT = 3306
const MIN_PORT = 1
const MAX_PORT = 65535
const DECIMAL_RADIX = 10

export interface ConnectionFormSeed {
  data: ConnectionFormData
  sourceHadPassword: boolean
  key: number
}

export type FormTab = 'general' | 'ssl' | 'advanced'
export type SslPathField = 'sslCaPath' | 'sslCertPath' | 'sslKeyPath'
export type PendingAction = 'test' | 'save' | 'connect' | 'delete'
export type FormErrors = Record<string, string>

export type UpdateField = <K extends keyof ConnectionFormData>(
  field: K,
  value: ConnectionFormData[K]
) => void

export const TAB_ORDER: FormTab[] = ['general', 'ssl', 'advanced']

const FIELD_TAB: Record<string, FormTab> = {
  name: 'general',
  host: 'general',
  port: 'general',
  username: 'general',
  connectTimeoutSecs: 'advanced',
  keepaliveIntervalSecs: 'advanced',
}

export interface DeleteConfirmState {
  error: string | null
}

export interface ConnectionEditorState {
  formData: ConnectionFormData
  errors: FormErrors
  activeTab: FormTab
  testResult: TestConnectionResult | null
  savedId: string | null
  hasSavedPassword: boolean
  clearSavedPassword: boolean
  deletedConnectionId: string | null
  deleteConfirm: DeleteConfirmState | null
}

export interface CurrentConnectionInputs {
  savedId: string | null
  editingConnection: SavedConnection | undefined
  deletedConnectionId: string | null
}

export interface FieldEdit<K extends keyof ConnectionFormData> {
  field: K
  value: ConnectionFormData[K]
}

function tabOfField(field: string): FormTab {
  return FIELD_TAB[field] ?? 'general'
}

export function tabHasError(errors: FormErrors, tab: FormTab): boolean {
  return Object.keys(errors).some((field) => tabOfField(field) === tab)
}

function firstTabWithError(errors: FormErrors): FormTab | null {
  return TAB_ORDER.find((tab) => tabHasError(errors, tab)) ?? null
}

function settingSecondsOr(settingKey: string, fallbackSeconds: number): number {
  const seconds = parseInt(useSettingsStore.getState().getSetting(settingKey), DECIMAL_RADIX)
  return isNaN(seconds) ? fallbackSeconds : seconds
}

export function getDefaultFormData(): ConnectionFormData {
  return {
    name: '',
    host: '',
    port: DEFAULT_MYSQL_PORT,
    username: '',
    password: '',
    defaultDatabase: null,
    sslEnabled: false,
    sslCaPath: null,
    sslCertPath: null,
    sslKeyPath: null,
    color: null,
    groupId: null,
    readOnly: false,
    connectTimeoutSecs: settingSecondsOr(
      'connection.defaultTimeout',
      DEFAULT_CONNECT_TIMEOUT_SECONDS
    ),
    keepaliveIntervalSecs: settingSecondsOr(
      'connection.defaultKeepalive',
      DEFAULT_KEEPALIVE_INTERVAL_SECONDS
    ),
  }
}

function isValidPort(port: number): boolean {
  return port >= MIN_PORT && port <= MAX_PORT
}

export function validate(data: ConnectionFormData): FormErrors {
  const errors: FormErrors = {}
  if (isBlank(data.name)) {
    errors.name = 'Connection name is required'
  }
  if (isBlank(data.host)) {
    errors.host = 'Host is required'
  }
  if (isBlank(data.username)) {
    errors.username = 'Username is required'
  }
  if (!isValidPort(data.port)) {
    errors.port = 'Port must be between 1 and 65535'
  }
  if (data.connectTimeoutSecs < 1) {
    errors.connectTimeoutSecs = 'Connect timeout must be at least 1 second'
  }
  if (data.keepaliveIntervalSecs < 0) {
    errors.keepaliveIntervalSecs = 'Keepalive interval cannot be negative'
  }
  return errors
}

export function hasFormErrors(errors: FormErrors): boolean {
  return Object.keys(errors).length > 0
}

export function validationPatch(
  formData: ConnectionFormData
): Pick<ConnectionEditorState, 'errors'> & Partial<Pick<ConnectionEditorState, 'activeTab'>> {
  const errors = validate(formData)
  const errorTab = firstTabWithError(errors)
  if (!errorTab) return { errors: errors }
  return { errors: errors, activeTab: errorTab }
}

export function buildErrorResult(error: unknown): TestConnectionResult {
  return {
    success: false,
    serverVersion: null,
    authMethod: null,
    sslStatus: null,
    connectionTimeMs: null,
    errorMessage: toErrorMessage(error),
  }
}

function formDataFromConnection(connection: SavedConnection): ConnectionFormData {
  return {
    name: connection.name,
    host: connection.host,
    port: connection.port,
    username: connection.username,
    password: '',
    defaultDatabase: connection.defaultDatabase,
    sslEnabled: connection.sslEnabled,
    sslCaPath: connection.sslCaPath,
    sslCertPath: connection.sslCertPath,
    sslKeyPath: connection.sslKeyPath,
    color: connection.color,
    groupId: connection.groupId,
    readOnly: connection.readOnly,
    connectTimeoutSecs: connection.connectTimeoutSecs,
    keepaliveIntervalSecs: connection.keepaliveIntervalSecs,
  }
}

function seededFormData(initialData: ConnectionFormSeed | undefined): ConnectionFormData {
  if (!initialData) return getDefaultFormData()
  return { ...initialData.data }
}

export function resolveCurrentConnectionId(inputs: CurrentConnectionInputs): string | null {
  if (inputs.savedId) return inputs.savedId
  const editingId = inputs.editingConnection?.id
  if (!editingId) return null
  if (editingId === inputs.deletedConnectionId) return null
  return editingId
}

export function createIdleEditorState(): ConnectionEditorState {
  return {
    formData: getDefaultFormData(),
    errors: {},
    activeTab: 'general',
    testResult: null,
    savedId: null,
    hasSavedPassword: false,
    clearSavedPassword: false,
    deletedConnectionId: null,
    deleteConfirm: null,
  }
}

export function editorStateFor(
  editingConnection: SavedConnection | undefined,
  initialData: ConnectionFormSeed | undefined
): ConnectionEditorState {
  const idle = createIdleEditorState()
  if (editingConnection) {
    return {
      ...idle,
      formData: formDataFromConnection(editingConnection),
      savedId: editingConnection.id,
      hasSavedPassword: editingConnection.hasPassword,
    }
  }
  return { ...idle, formData: seededFormData(initialData) }
}

export function deletedEditorState(
  current: ConnectionEditorState,
  deletedConnectionId: string
): ConnectionEditorState {
  return {
    ...createIdleEditorState(),
    activeTab: current.activeTab,
    deletedConnectionId: deletedConnectionId,
  }
}

function withoutFieldError(errors: FormErrors, field: string): FormErrors {
  if (!errors[field]) return errors
  return withoutKey(errors, field)
}

export function editorWithField<K extends keyof ConnectionFormData>(
  current: ConnectionEditorState,
  { field, value }: FieldEdit<K>
): ConnectionEditorState {
  return {
    ...current,
    formData: { ...current.formData, [field]: value },
    errors: withoutFieldError(current.errors, field),
  }
}

export function shouldUseSavedPassword(editor: ConnectionEditorState): boolean {
  const keepsSavedPassword = editor.hasSavedPassword && !editor.clearSavedPassword
  return keepsSavedPassword && editor.formData.password === ''
}

export function hasSavedPasswordAfterUpdate(editor: ConnectionEditorState): boolean {
  if (editor.clearSavedPassword) return false
  return editor.hasSavedPassword || editor.formData.password !== ''
}
