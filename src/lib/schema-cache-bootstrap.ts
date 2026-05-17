import {
  hydrateFromSnapshot,
  rebuildCache,
  refreshCacheInBackground,
  serializeCacheSnapshot,
} from '../components/query-editor/schema-metadata-cache'
import { logFrontend } from './app-log-commands'
import { loadSchemaCacheSnapshot, saveSchemaCacheSnapshot } from './schema-cache-commands'

/** In-flight bootstrap promises — one per connection. */
const _pendingBootstraps = new Map<string, Promise<void>>()

/**
 * Returns the in-flight bootstrap promise for a connection, or null if not bootstrapping.
 * Used by the completion service to await the initial cache population when the cache
 * is still empty (bootstrapSchemaCache hasn't hydrated the snapshot yet).
 */
export function getPendingBootstrap(connectionId: string): Promise<void> | null {
  return _pendingBootstraps.get(connectionId) ?? null
}

/** Clear all pending bootstraps. For test cleanup only. */
export function _clearPendingBootstraps(): void {
  _pendingBootstraps.clear()
}

export async function bootstrapSchemaCache(connectionId: string): Promise<void> {
  // The "initial load" promise covers only the fast path: loading and hydrating
  // the persisted snapshot (or a full rebuild if no snapshot exists). The
  // background refresh runs independently and does NOT block the pending
  // bootstrap. This lets the completion service unblock as soon as the cache
  // becomes usable, rather than waiting for the full schema re-fetch.
  let resolveInitial!: () => void
  const initialLoadPromise = new Promise<void>((resolve) => {
    resolveInitial = resolve
  })

  _pendingBootstraps.set(connectionId, initialLoadPromise)

  let hasHydratedSnapshot = false

  try {
    const snapshot = await loadSchemaCacheSnapshot(connectionId)
    if (snapshot) {
      hydrateFromSnapshot(snapshot, connectionId)
      hasHydratedSnapshot = true
    }
  } catch (err) {
    logFrontend(
      'warn',
      ['[schema-cache-bootstrap] Failed to load persisted schema cache:', err].map(String).join(' ')
    )
  }

  if (hasHydratedSnapshot) {
    // Cache is already usable with stale data — unblock waiters immediately.
    resolveInitial()
    if (_pendingBootstraps.get(connectionId) === initialLoadPromise) {
      _pendingBootstraps.delete(connectionId)
    }

    // Refresh in the background (non-blocking for callers).
    try {
      await refreshCacheInBackground(connectionId)
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
  } else {
    // No snapshot — must do a full rebuild before unblocking.
    try {
      await rebuildCache(connectionId)
      resolveInitial()
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
      // Still resolve (don't leave waiters hanging — cache will be in error state)
      resolveInitial()
    } finally {
      if (_pendingBootstraps.get(connectionId) === initialLoadPromise) {
        _pendingBootstraps.delete(connectionId)
      }
    }
  }
}
