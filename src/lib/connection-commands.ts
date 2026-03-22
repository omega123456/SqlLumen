import { invoke } from '@tauri-apps/api/core'
import type {
  SavedConnection,
  ConnectionGroup,
  ConnectionFormData,
  TestConnectionResult,
} from '../types/connection'

// --- Connection CRUD ---

/**
 * Save a new connection profile. Returns the new connection's UUID.
 * Empty password is converted to null (meaning "no password").
 */
export async function saveConnection(data: ConnectionFormData): Promise<string> {
  return invoke<string>('save_connection', {
    data: {
      ...data,
      password: data.password || null,
      sortOrder: 0,
    },
  })
}

/**
 * Get a single saved connection by ID.
 */
export async function getConnection(id: string): Promise<SavedConnection> {
  return invoke<SavedConnection>('get_connection', { id })
}

/**
 * List all saved connections.
 */
export async function listConnections(): Promise<SavedConnection[]> {
  return invoke<SavedConnection[]>('list_connections')
}

/**
 * Update an existing connection profile.
 * Empty password means "don't change the existing password".
 */
export async function updateConnection(
  id: string,
  data: ConnectionFormData,
  options?: { clearPassword?: boolean }
): Promise<void> {
  return invoke<void>('update_connection', {
    id,
    data: {
      ...data,
      password: data.password || null,
      clearPassword: options?.clearPassword ?? false,
      sortOrder: 0,
    },
  })
}

/**
 * Delete a connection by ID.
 */
export async function deleteConnection(id: string): Promise<void> {
  return invoke<void>('delete_connection', { id })
}

// --- Group CRUD ---

/**
 * Create a new connection group. Returns the new group's UUID.
 */
export async function createConnectionGroup(name: string): Promise<string> {
  return invoke<string>('create_connection_group', { name })
}

/**
 * List all connection groups.
 */
export async function listConnectionGroups(): Promise<ConnectionGroup[]> {
  return invoke<ConnectionGroup[]>('list_connection_groups')
}

/**
 * Update a connection group's name.
 */
export async function updateConnectionGroup(id: string, name: string): Promise<void> {
  return invoke<void>('update_connection_group', { id, name })
}

/**
 * Delete a connection group by ID.
 */
export async function deleteConnectionGroup(id: string): Promise<void> {
  return invoke<void>('delete_connection_group', { id })
}

// --- MySQL connectivity ---

/**
 * Test a MySQL connection with the given parameters.
 * Only passes fields relevant to the connection test (excludes name, color, etc.).
 */
export async function testConnection(params: ConnectionFormData): Promise<TestConnectionResult> {
  return invoke<TestConnectionResult>('test_connection', {
    input: {
      host: params.host,
      port: params.port,
      username: params.username,
      password: params.password,
      defaultDatabase: params.defaultDatabase,
      sslEnabled: params.sslEnabled,
      sslCaPath: params.sslCaPath,
      sslCertPath: params.sslCertPath,
      sslKeyPath: params.sslKeyPath,
      connectTimeoutSecs: params.connectTimeoutSecs,
    },
  })
}

/**
 * Open a saved connection profile. Returns a new runtime session id and server version.
 * Multiple calls with the same profile id create independent sessions (separate pools).
 */
export async function openConnection(
  profileId: string
): Promise<{ sessionId: string; serverVersion: string }> {
  return invoke<{ sessionId: string; serverVersion: string }>('open_connection', {
    payload: { profileId },
  })
}

/**
 * Close an open connection session by its runtime session id.
 */
export async function closeConnection(sessionId: string): Promise<void> {
  return invoke<void>('close_connection', { connectionId: sessionId })
}

/**
 * Get the current status of an open connection session.
 * Returns null if the session id is not found in the registry.
 */
export async function getConnectionStatus(
  sessionId: string
): Promise<'connected' | 'disconnected' | 'reconnecting' | null> {
  return invoke<'connected' | 'disconnected' | 'reconnecting' | null>('get_connection_status', {
    connectionId: sessionId,
  })
}
