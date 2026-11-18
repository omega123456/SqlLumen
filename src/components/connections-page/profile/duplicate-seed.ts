import type { ConnectionFormSeed, SavedConnection } from '../../../types/connection'

export function duplicateSeedFor(source: SavedConnection): ConnectionFormSeed {
  return {
    data: {
      name: `Copy of ${source.name.trim() || source.host}`,
      host: source.host,
      port: source.port,
      username: source.username,
      password: '',
      defaultDatabase: source.defaultDatabase,
      sslMode: source.sslMode,
      sslCaPath: source.sslCaPath,
      sslCertPath: source.sslCertPath,
      sslKeyPath: source.sslKeyPath,
      color: source.color,
      groupId: source.groupId,
      readOnly: source.readOnly,
      connectTimeoutSecs: source.connectTimeoutSecs,
      keepaliveIntervalSecs: source.keepaliveIntervalSecs,
    },
    sourceHadPassword: source.hasPassword,
  }
}
