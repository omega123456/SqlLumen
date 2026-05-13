import { invoke } from '@tauri-apps/api/core'

export async function loadSchemaCacheSnapshot(connectionId: string): Promise<string | null> {
  return invoke<string | null>('load_schema_cache_snapshot', { connectionId })
}

export async function saveSchemaCacheSnapshot(
  connectionId: string,
  snapshotJson: string
): Promise<void> {
  return invoke<void>('save_schema_cache_snapshot', { connectionId, snapshotJson })
}
