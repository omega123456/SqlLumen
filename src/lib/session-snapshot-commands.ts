import { invokeArgumentCommand, invokeCommand, NO_ARGUMENTS } from './ipc/dispatch'

export type SnapshotTrigger = 'onClose' | 'daily' | 'weekly' | 'manual' | 'beforeRestore'

export interface SnapshotConnectionSummary {
  name: string
  tabCount: number
}

export interface SnapshotSummary {
  id: number
  createdAt: string
  triggerType: SnapshotTrigger
  connectionCount: number
  tabCount: number
  connections: SnapshotConnectionSummary[]
}

export interface CreateSnapshotArgs {
  triggerType: SnapshotTrigger
  connectionCount: number
  tabCount: number
  summaryJson: string
  stateJson: string
  keep: number
}

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
