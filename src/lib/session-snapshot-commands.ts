import { invokeArgumentCommand, invokeCommand, NO_ARGUMENTS } from './ipc/dispatch'

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

export async function createSessionSnapshot(args: CreateSnapshotArgs): Promise<number> {
  return invokeCommand({ command: 'create_session_snapshot', payload: args })
}

export async function listSessionSnapshots(): Promise<SnapshotSummary[]> {
  return invokeArgumentCommand({ command: 'list_session_snapshots', argument: NO_ARGUMENTS })
}

export async function getSessionSnapshot(id: number): Promise<string | null> {
  return invokeArgumentCommand({ command: 'get_session_snapshot', argument: { id } })
}

export async function deleteSessionSnapshot(id: number): Promise<void> {
  await invokeArgumentCommand({ command: 'delete_session_snapshot', argument: { id } })
}
