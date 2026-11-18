export type SslMode = 'disabled' | 'preferred' | 'required' | 'verify_ca' | 'verify_identity'

export interface SavedConnection {
  id: string
  name: string
  host: string
  port: number
  username: string
  hasPassword: boolean
  defaultDatabase: string | null
  sslMode: SslMode
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
  lastConnectedAt: string | null
}

export interface ConnectionGroup {
  id: string
  name: string
  parentId: string | null
  sortOrder: number
  createdAt: string
}

export interface ActiveConnection {
  id: string
  profile: SavedConnection
  sessionDatabase?: string | null
  status: 'connected' | 'disconnected' | 'reconnecting'
  serverVersion: string
}

export interface OpenConnectionSession {
  sessionId: string
  profileId: string
  status: ActiveConnection['status']
  serverVersion: string
  sessionDatabase: string | null
}

export interface TestConnectionResult {
  success: boolean
  serverVersion: string | null
  authMethod: string | null
  sslStatus: string | null
  connectionTimeMs: number | null
  errorMessage: string | null
}

export interface ConnectionFormData {
  name: string
  host: string
  port: number
  username: string
  password: string
  defaultDatabase: string | null
  sslMode: SslMode
  sslCaPath: string | null
  sslCertPath: string | null
  sslKeyPath: string | null
  color: string | null
  groupId: string | null
  readOnly: boolean
  connectTimeoutSecs: number
  keepaliveIntervalSecs: number
}

export interface ConnectionFormSeed {
  data: ConnectionFormData
  sourceHadPassword: boolean
}

export interface ConnectionStatusEvent {
  connectionId: string
  status: 'connected' | 'disconnected' | 'reconnecting'
  message?: string
}
