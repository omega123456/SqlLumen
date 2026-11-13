import { invokeArgumentCommand, invokeCommand } from './ipc/dispatch'

export async function loadSchemaCacheSnapshot(connectionId: string): Promise<string | null> {
  return invokeArgumentCommand({
    command: 'load_schema_cache_snapshot',
    argument: { connectionId },
  })
}

export async function saveSchemaCacheSnapshot(
  connectionId: string,
  snapshotJson: string
): Promise<void> {
  return invokeCommand({
    command: 'save_schema_cache_snapshot',
    payload: { connectionId, snapshotJson },
  })
}
