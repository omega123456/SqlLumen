import { invoke } from '@tauri-apps/api/core'

/**
 * Session snapshot IPC wrappers.
 *
 * Snapshots are timestamped captures of the full workspace `SessionState`
 * (the same JSON the existing session-restore engine produces / consumes),
 * stored in a dedicated SQLite `session_snapshots` table on the backend.
 *
 * The list endpoint returns lightweight summaries (no `state_json`); the full
 * state is fetched only for the snapshot being restored.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** What caused a snapshot to be created. */
export type SnapshotTrigger = 'onClose' | 'daily' | 'weekly' | 'manual' | 'beforeRestore'

/** Per-connection breakdown shown in a snapshot row. */
export interface SnapshotConnectionSummary {
  name: string
  tabCount: number
}

/** Lightweight snapshot record returned by the list endpoint (no `state_json`). */
export interface SnapshotSummary {
  id: number
  createdAt: string
  triggerType: SnapshotTrigger
  connectionCount: number
  tabCount: number
  connections: SnapshotConnectionSummary[]
}

/** Input shape for creating a snapshot. */
export interface CreateSnapshotArgs {
  triggerType: SnapshotTrigger
  connectionCount: number
  tabCount: number
  /** JSON string of `SnapshotConnectionSummary[]`. */
  summaryJson: string
  /** JSON string of the full `SessionState`. */
  stateJson: string
  /** Retention cap — backend prunes oldest rows beyond this after insert. */
  keep: number
}

// ---------------------------------------------------------------------------
// IPC Wrappers
// ---------------------------------------------------------------------------

/**
 * Create a snapshot with its metadata and prune to `keep` atomically.
 * Returns the new snapshot id.
 */
export async function createSessionSnapshot(args: CreateSnapshotArgs): Promise<number> {
  return invoke<number>('create_session_snapshot', {
    triggerType: args.triggerType,
    connectionCount: args.connectionCount,
    tabCount: args.tabCount,
    summaryJson: args.summaryJson,
    stateJson: args.stateJson,
    keep: args.keep,
  })
}

/** List all snapshot summaries, newest first (no `state_json`). */
export async function listSessionSnapshots(): Promise<SnapshotSummary[]> {
  return invoke<SnapshotSummary[]>('list_session_snapshots')
}

/** Fetch the full `state_json` for one snapshot, or null if it no longer exists. */
export async function getSessionSnapshot(id: number): Promise<string | null> {
  return invoke<string | null>('get_session_snapshot', { id })
}

/** Delete one snapshot by id. */
export async function deleteSessionSnapshot(id: number): Promise<void> {
  await invoke<void>('delete_session_snapshot', { id })
}
