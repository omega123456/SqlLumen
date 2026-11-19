import { invokeArgumentCommand, invokeCommand, NO_ARGUMENTS } from './ipc/dispatch'
import type {
  SavedConnection,
  ConnectionGroup,
  ConnectionFormData,
  OpenConnectionSession,
  TestConnectionResult,
  SslMode,
} from '../types/connection'

export interface SaveConnectionInput extends Omit<ConnectionFormData, 'password'> {
  password: string | null
  sortOrder: number
}

export interface UpdateConnectionInput extends SaveConnectionInput {
  clearPassword: boolean
}

export interface TestConnectionInput {
  host: string
  port: number
  username: string
  password: string
  profileId: string | null
  defaultDatabase: string | null
  sslMode: SslMode
  sslCaPath: string | null
  sslCertPath: string | null
  sslKeyPath: string | null
  connectTimeoutSecs: number
}

export interface OpenConnectionResult {
  sessionId: string
  serverVersion: string
  lastConnectedAt: string | null
}

export type OpenConnectionErrorKind = 'accessDenied' | 'failed'

interface OpenConnectionErrorPayload {
  kind: OpenConnectionErrorKind
  message: string
}

export class OpenConnectionError extends Error {
  readonly kind: OpenConnectionErrorKind

  constructor(payload: OpenConnectionErrorPayload) {
    super(payload.message)
    this.name = 'OpenConnectionError'
    this.kind = payload.kind
  }
}

function isOpenConnectionErrorPayload(value: unknown): value is OpenConnectionErrorPayload {
  if (typeof value !== 'object') return false
  if (value === null) return false
  const hasKind = 'kind' in value
  return hasKind && 'message' in value
}

function toOpenConnectionError(error: unknown): unknown {
  if (!isOpenConnectionErrorPayload(error)) return error
  return new OpenConnectionError(error)
}

export function isAccessDenied(error: unknown): boolean {
  return error instanceof OpenConnectionError && error.kind === 'accessDenied'
}

export type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting'

const DEFAULT_SORT_ORDER = 0

function toSaveConnectionInput(data: ConnectionFormData): SaveConnectionInput {
  return { ...data, password: data.password || null, sortOrder: DEFAULT_SORT_ORDER }
}

function toTestConnectionInput(
  params: ConnectionFormData,
  profileId: string | null
): TestConnectionInput {
  return {
    host: params.host,
    port: params.port,
    username: params.username,
    password: params.password,
    profileId: profileId,
    defaultDatabase: params.defaultDatabase,
    sslMode: params.sslMode,
    sslCaPath: params.sslCaPath,
    sslCertPath: params.sslCertPath,
    sslKeyPath: params.sslKeyPath,
    connectTimeoutSecs: params.connectTimeoutSecs,
  }
}

export async function saveConnection(data: ConnectionFormData): Promise<string> {
  return invokeArgumentCommand({
    command: 'save_connection',
    argument: { data: toSaveConnectionInput(data) },
  })
}

export async function getConnection(id: string): Promise<SavedConnection> {
  return invokeArgumentCommand({ command: 'get_connection', argument: { id } })
}

export async function listConnections(): Promise<SavedConnection[]> {
  return invokeArgumentCommand({ command: 'list_connections', argument: NO_ARGUMENTS })
}

export async function updateConnection(
  id: string,
  data: ConnectionFormData,
  options?: { clearPassword?: boolean }
): Promise<void> {
  const input = { ...toSaveConnectionInput(data), clearPassword: options?.clearPassword ?? false }
  return invokeCommand({ command: 'update_connection', payload: { id: id, data: input } })
}

export async function deleteConnection(id: string): Promise<void> {
  return invokeArgumentCommand({ command: 'delete_connection', argument: { id } })
}

export async function createConnectionGroup(name: string): Promise<string> {
  return invokeArgumentCommand({ command: 'create_connection_group', argument: { name } })
}

export async function listConnectionGroups(): Promise<ConnectionGroup[]> {
  return invokeArgumentCommand({ command: 'list_connection_groups', argument: NO_ARGUMENTS })
}

export interface ConnectionGroupChanges {
  id: string
  name: string
  color: string | null
}

export async function updateConnectionGroup(changes: ConnectionGroupChanges): Promise<void> {
  return invokeCommand({ command: 'update_connection_group', payload: changes })
}

export async function deleteConnectionGroup(id: string): Promise<void> {
  return invokeArgumentCommand({ command: 'delete_connection_group', argument: { id } })
}

export async function testConnection(
  params: ConnectionFormData,
  profileId?: string | null
): Promise<TestConnectionResult> {
  return invokeArgumentCommand({
    command: 'test_connection',
    argument: { input: toTestConnectionInput(params, profileId ?? null) },
  })
}

export async function openConnection(
  profileId: string,
  password?: string
): Promise<OpenConnectionResult> {
  try {
    return await invokeCommand({
      command: 'open_connection',
      payload: { profileId: profileId, password: password ?? null },
    })
  } catch (error) {
    throw toOpenConnectionError(error)
  }
}

export async function closeConnection(sessionId: string): Promise<void> {
  return invokeArgumentCommand({
    command: 'close_connection',
    argument: { connectionId: sessionId },
  })
}

export async function getConnectionStatus(sessionId: string): Promise<ConnectionStatus | null> {
  return invokeArgumentCommand({
    command: 'get_connection_status',
    argument: { connectionId: sessionId },
  })
}

export async function listOpenConnectionSessions(): Promise<OpenConnectionSession[]> {
  return invokeArgumentCommand({ command: 'list_open_connection_sessions', argument: NO_ARGUMENTS })
}
