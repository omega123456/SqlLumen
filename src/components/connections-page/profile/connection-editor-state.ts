import { useSettingsStore } from '../../../stores/settings-store'
import type {
  ConnectionFormData,
  ConnectionFormSeed,
  SavedConnection,
  TestConnectionResult,
} from '../../../types/connection'
import { toErrorMessage } from '../../../lib/error-message'
import { isBlank } from '../../../lib/value-checks'
import { withoutKey } from '../../../lib/record-utils'
import { DEFAULT_MYSQL_PORT } from '../../../lib/mysql-connection-url'
import { formDataFromConnection } from '../../../lib/connection-form-data'
import { sectionsWithErrors, type ProfileSection } from './profile-sections'

export const DEFAULT_CONNECT_TIMEOUT_SECONDS = 10
export const DEFAULT_KEEPALIVE_INTERVAL_SECONDS = 60
const MIN_PORT = 1
const MAX_PORT = 65535
const DECIMAL_RADIX = 10

export type SslPathField = 'sslCaPath' | 'sslCertPath' | 'sslKeyPath'
export type PendingAction = 'test' | 'save' | 'connect'
export type FormErrors = Record<string, string>

export type UpdateField = <K extends keyof ConnectionFormData>(
  field: K,
  value: ConnectionFormData[K]
) => void

export interface ConnectionEditorState {
  formData: ConnectionFormData
  errors: FormErrors
  testResult: TestConnectionResult | null
  savedId: string | null
  hasSavedPassword: boolean
  savePassword: boolean
}

export interface FieldEdit<K extends keyof ConnectionFormData> {
  field: K
  value: ConnectionFormData[K]
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
    sslMode: 'preferred',
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
  return { ...errors, ...clientIdentityErrors(data) }
}

function clientIdentityErrors(data: ConnectionFormData): FormErrors {
  const hasCertificate = !isBlank(data.sslCertPath ?? '')
  const hasKey = !isBlank(data.sslKeyPath ?? '')
  if (hasCertificate === hasKey) return {}
  if (hasCertificate) return { sslKeyPath: 'Add the client key that goes with the certificate' }
  return { sslCertPath: 'Add the client certificate that goes with the key' }
}

export function hasFormErrors(errors: FormErrors): boolean {
  return Object.keys(errors).length > 0
}

export interface ValidationOutcome {
  errors: FormErrors
  sectionsToOpen: ProfileSection[]
}

export function validationPatch(formData: ConnectionFormData): ValidationOutcome {
  const errors = validate(formData)
  return { errors: errors, sectionsToOpen: sectionsWithErrors(errors) }
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

function seededFormData(initialData: ConnectionFormSeed | undefined): ConnectionFormData {
  if (!initialData) return getDefaultFormData()
  return { ...initialData.data }
}

export function resolveCurrentConnectionId(
  editor: ConnectionEditorState,
  editingConnection: SavedConnection | undefined
): string | null {
  return editor.savedId ?? editingConnection?.id ?? null
}

export function createIdleEditorState(): ConnectionEditorState {
  return {
    formData: getDefaultFormData(),
    errors: {},
    testResult: null,
    savedId: null,
    hasSavedPassword: false,
    savePassword: true,
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
  const keepsSavedPassword = editor.hasSavedPassword && editor.savePassword
  return keepsSavedPassword && editor.formData.password === ''
}

export function hasSavedPasswordAfterUpdate(editor: ConnectionEditorState): boolean {
  if (!editor.savePassword) return false
  return editor.hasSavedPassword || editor.formData.password !== ''
}

export function clearsSavedPassword(editor: ConnectionEditorState): boolean {
  return editor.hasSavedPassword && !editor.savePassword
}

export function formDataToStore(editor: ConnectionEditorState): ConnectionFormData {
  if (editor.savePassword) return editor.formData
  return { ...editor.formData, password: '' }
}

export function oneOffPassword(editor: ConnectionEditorState): string | undefined {
  if (editor.savePassword) return undefined
  const password = editor.formData.password
  if (password === '') return undefined
  return password
}
