import {
  hydrateFromSnapshot,
  rebuildCache,
  refreshCacheInBackground,
  serializeCacheSnapshot,
} from '../components/query-editor/schema-metadata-cache'
import { logFrontend } from './app-log-commands'
import { loadSchemaCacheSnapshot, saveSchemaCacheSnapshot } from './schema-cache-commands'
import { toErrorMessage } from './error-message'

const _pendingBootstraps = new Map<string, Promise<void>>()

export function getPendingBootstrap(connectionId: string): Promise<void> | null {
  return _pendingBootstraps.get(connectionId) ?? null
}

export function _clearPendingBootstraps(): void {
  _pendingBootstraps.clear()
}

export async function bootstrapSchemaCache(
  sessionId: string,
  savedConnectionId: string
): Promise<void> {
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
  } catch (error) {
    const message = toErrorMessage(error)
    logFrontend(
      'warn',
      `[schema-cache-bootstrap] Failed to load persisted schema cache: ${message}`
    )
  }

  const releasePendingBootstrap = () => {
    const isOwnPendingBootstrap = _pendingBootstraps.get(sessionId) === initialLoadPromise
    if (isOwnPendingBootstrap) {
      _pendingBootstraps.delete(sessionId)
    }
  }

  if (hasHydratedSnapshot) {
    resolveInitial()
    releasePendingBootstrap()
    await refreshAndPersistCache(sessionId, savedConnectionId)
    return
  }

  try {
    await rebuildCache(sessionId)
    resolveInitial()
    await persistCacheSnapshot(sessionId, savedConnectionId)
  } catch (error) {
    logCacheRebuildFailure(error)
    resolveInitial()
  } finally {
    releasePendingBootstrap()
  }
}

async function persistCacheSnapshot(sessionId: string, savedConnectionId: string): Promise<void> {
  const freshSnapshot = serializeCacheSnapshot(sessionId)
  if (freshSnapshot) {
    await saveSchemaCacheSnapshot(savedConnectionId, freshSnapshot)
  }
}

function logCacheRebuildFailure(error: unknown): void {
  const message = toErrorMessage(error)
  logFrontend(
    'warn',
    `[schema-cache-bootstrap] Failed to rebuild persisted schema cache: ${message}`
  )
}

async function refreshAndPersistCache(sessionId: string, savedConnectionId: string): Promise<void> {
  try {
    await refreshCacheInBackground(sessionId)
    await persistCacheSnapshot(sessionId, savedConnectionId)
  } catch (error) {
    logCacheRebuildFailure(error)
  }
}
