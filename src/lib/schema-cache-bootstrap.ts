import {
  hydrateFromSnapshot,
  rebuildCache,
  serializeCacheSnapshot,
} from '../components/query-editor/schema-metadata-cache'
import { logFrontend } from './app-log-commands'
import { loadSchemaCacheSnapshot, saveSchemaCacheSnapshot } from './schema-cache-commands'

export async function bootstrapSchemaCache(connectionId: string): Promise<void> {
  try {
    const snapshot = await loadSchemaCacheSnapshot(connectionId)
    if (snapshot) {
      hydrateFromSnapshot(snapshot, connectionId)
    }
  } catch (err) {
    logFrontend(
      'warn',
      ['[schema-cache-bootstrap] Failed to load persisted schema cache:', err].map(String).join(' ')
    )
  }

  try {
    await rebuildCache(connectionId)
    const freshSnapshot = serializeCacheSnapshot(connectionId)
    if (freshSnapshot) {
      await saveSchemaCacheSnapshot(connectionId, freshSnapshot)
    }
  } catch (err) {
    logFrontend(
      'warn',
      ['[schema-cache-bootstrap] Failed to rebuild persisted schema cache:', err]
        .map(String)
        .join(' ')
    )
  }
}
