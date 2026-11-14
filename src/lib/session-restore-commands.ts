import { logFrontend, logFrontendWarning } from './app-log-commands'

import { getSetting, setSetting } from './tauri-commands'

export interface SessionState {
  version: 1
  connections: SessionConnectionState[]
  activeConnectionIndex?: number
}

export interface SessionConnectionState {
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
      activeBottomPanelTableTabId?: string
    }
  | {
      type: 'table-data'
      tabId: string
      databaseName: string
      tableName: string
      parentQueryTabId?: string
      objectType?: 'table' | 'view'
    }
  | {
      type: 'schema-info'
      tabId: string
      databaseName: string
      objectName: string
      objectType: string
    }
  | {
      type: 'history'
      tabId: string
    }

const SESSION_STATE_KEY = 'session.state'

export async function saveSessionState(state: SessionState): Promise<void> {
  const json = JSON.stringify(state)
  await setSetting(SESSION_STATE_KEY, json)
}

function isSupportedSessionState(parsed: SessionState | null): parsed is SessionState {
  if (!parsed) return false
  return parsed.version === 1 && Array.isArray(parsed.connections)
}

export async function loadSessionState(): Promise<SessionState | null> {
  const raw = await getSetting(SESSION_STATE_KEY)
  const hasNoSavedState = !raw || raw === 'null'
  if (hasNoSavedState) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as SessionState
    if (isSupportedSessionState(parsed)) {
      return parsed
    }
    logFrontend('warn', '[session-restore] Invalid session state version or structure, ignoring')
    return null
  } catch (error) {
    logFrontendWarning('[session-restore] Failed to parse session state JSON:', error)
    return null
  }
}
