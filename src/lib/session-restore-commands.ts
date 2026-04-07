/**
 * Session restore IPC wrappers.
 *
 * Session state is persisted as a JSON string in the `session.state` settings key.
 * Uses the existing `getSetting` / `setSetting` IPC commands — no new Rust commands needed.
 */

import { getSetting, setSetting } from './tauri-commands'

// ---------------------------------------------------------------------------
// Session State Types
// ---------------------------------------------------------------------------

export interface SessionState {
  version: 1
  connections: SessionConnectionState[]
}

export interface SessionConnectionState {
  /** Saved profile ID (NOT runtime session ID). */
  profileId: string
  activeTabIndex: number
  tabs: SessionTabState[]
}

export type SessionTabState =
  | {
      type: 'query-editor'
      tabId: string
      sql: string
      cursorLine?: number
      cursorColumn?: number
      label?: string
    }
  | {
      type: 'table-data'
      tabId: string
      databaseName: string
      tableName: string
    }
  | {
      type: 'schema-info'
      tabId: string
      databaseName: string
      objectName: string
      objectType: string
    }
  | {
      type: 'history-favorites'
      tabId: string
    }

// ---------------------------------------------------------------------------
// IPC Wrappers
// ---------------------------------------------------------------------------

const SESSION_STATE_KEY = 'session.state'

/**
 * Persist session state to the backend settings store.
 * Serializes the state as a JSON string.
 */
export async function saveSessionState(state: SessionState): Promise<void> {
  const json = JSON.stringify(state)
  await setSetting(SESSION_STATE_KEY, json)
}

/**
 * Load session state from the backend settings store.
 * Returns null if no state is stored or the stored value is invalid.
 */
export async function loadSessionState(): Promise<SessionState | null> {
  const raw = await getSetting(SESSION_STATE_KEY)
  if (!raw || raw === 'null') {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as SessionState
    if (parsed && parsed.version === 1 && Array.isArray(parsed.connections)) {
      return parsed
    }
    console.warn('[session-restore] Invalid session state version or structure, ignoring')
    return null
  } catch (e) {
    console.warn('[session-restore] Failed to parse session state JSON:', e)
    return null
  }
}
