import type { ConnectionFormData, SavedConnection } from '../types/connection'

const KEEP_EXISTING_PASSWORD = ''

export function formDataFromConnection(connection: SavedConnection): ConnectionFormData {
  return {
    name: connection.name,
    host: connection.host,
    port: connection.port,
    username: connection.username,
    password: KEEP_EXISTING_PASSWORD,
    defaultDatabase: connection.defaultDatabase,
    sslMode: connection.sslMode,
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
