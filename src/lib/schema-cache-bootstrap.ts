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

/**
 * Hydrates the live in-memory schema cache for a session and persists a snapshot
 * for the saved connection.
 *
 * @param sessionId The ephemeral per-connect session id. Keys the in-memory cache
 *   and the pending-bootstrap map (metadata fetches run against a live session).
 * @param savedConnectionId The stable saved-connection id. Keys snapshot
 *   persistence (load/save), so reconnects hit one bounded row per connection.
 */
export async function bootstrapSchemaCache(
  sessionId: string,
  savedConnectionId: string
): Promise<void> {
  // The "initial load" promise covers only the fast path: loading and hydrating
  // the persisted snapshot (or a full rebuild if no snapshot exists). The
  // background refresh runs independently and does NOT block the pending
  // bootstrap. This lets the completion service unblock as soon as the cache
  // becomes usable, rather than waiting for the full schema re-fetch.
  let resolveInitial!: () => void
  const initialLoadPromise = new Promise<void>((resolve) => {
    resolveInitial = resolve
  })

  _pendingBootstraps.set(sessionId, initialLoadPromise)

  let hasHydratedSnapshot = false

  try {
    const snapshot = await loadSchemaCacheSnapshot(savedConnectionId)
    if (snapshot) {
      hydrateFromSnapshot(snapshot, sessionId)
      hasHydratedSnapshot = true
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logFrontend('warn', `[schema-cache-bootstrap] Failed to load persisted schema cache: ${msg}`)
  }

  if (hasHydratedSnapshot) {
    // Cache is already usable with stale data — unblock waiters immediately.
    resolveInitial()
    if (_pendingBootstraps.get(sessionId) === initialLoadPromise) {
      _pendingBootstraps.delete(sessionId)
    }

    // Refresh in the background (non-blocking for callers).
    try {
      await refreshCacheInBackground(sessionId)
      const freshSnapshot = serializeCacheSnapshot(sessionId)
      if (freshSnapshot) {
        await saveSchemaCacheSnapshot(savedConnectionId, freshSnapshot)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logFrontend(
        'warn',
        `[schema-cache-bootstrap] Failed to rebuild persisted schema cache: ${msg}`
      )
    }
  } else {
    // No snapshot — must do a full rebuild before unblocking.
    try {
      await rebuildCache(sessionId)
      resolveInitial()
      const freshSnapshot = serializeCacheSnapshot(sessionId)
      if (freshSnapshot) {
        await saveSchemaCacheSnapshot(savedConnectionId, freshSnapshot)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logFrontend(
        'warn',
        `[schema-cache-bootstrap] Failed to rebuild persisted schema cache: ${msg}`
      )
      // Still resolve (don't leave waiters hanging — cache will be in error state)
      resolveInitial()
    } finally {
      if (_pendingBootstraps.get(sessionId) === initialLoadPromise) {
        _pendingBootstraps.delete(sessionId)
      }
    }
  }
}
