/**
 * TypeScript types for connection data models.
 *
 * Field names use camelCase — the Rust backend uses snake_case internally,
 * but Tauri's serde serialization handles conversion via `#[serde(rename_all = "camelCase")]`.
 */

/**
 * A saved connection profile as returned from the backend.
 * Note: never contains the password — only `hasPassword` boolean.
 */
export interface SavedConnection {
  id: string
  name: string
  host: string
  port: number
  username: string
  hasPassword: boolean
  defaultDatabase: string | null
  sslEnabled: boolean
  sslCaPath: string | null
  sslCertPath: string | null
  sslKeyPath: string | null
  color: string | null
  groupId: string | null
  readOnly: boolean
  sortOrder: number
  connectTimeoutSecs: number
  keepaliveIntervalSecs: number
  createdAt: string
  updatedAt: string
}

/**
 * A connection group record from the backend.
 * `parentId` is always null in v1, included for forward-compatibility.
 */
export interface ConnectionGroup {
  id: string
  name: string
  parentId: string | null
  sortOrder: number
  createdAt: string
}

/**
 * An active (open) connection with its profile and runtime status.
 * `id` is the runtime session id (MySQL pool key); `profile.id` is the saved profile row id.
 */
export interface ActiveConnection {
  /** Runtime session id — use for IPC (`connectionId`) and UI tab keys. */
  id: string
  profile: SavedConnection
  /** Current session database used by the live MySQL session. */
  sessionDatabase?: string | null
  status: 'connected' | 'disconnected' | 'reconnecting'
  serverVersion: string
}

/**
 * Result of testing a MySQL connection.
 */
export interface TestConnectionResult {
  success: boolean
  serverVersion: string | null
  authMethod: string | null
  sslStatus: string | null
  connectionTimeMs: number | null
  errorMessage: string | null
}

/**
 * Form data for creating or updating a connection.
 * Contains the plain password string (unlike SavedConnection which has hasPassword boolean).
 */
export interface ConnectionFormData {
  name: string
  host: string
  port: number
  username: string
  password: string
  defaultDatabase: string | null
  sslEnabled: boolean
  sslCaPath: string | null
  sslCertPath: string | null
  sslKeyPath: string | null
  color: string | null
  groupId: string | null
  readOnly: boolean
  connectTimeoutSecs: number
  keepaliveIntervalSecs: number
}

/**
 * Event payload for connection status changes (from Tauri event system).
 * `connectionId` is the runtime session id.
 */
export interface ConnectionStatusEvent {
  connectionId: string
  status: 'connected' | 'disconnected' | 'reconnecting'
  message?: string
}
