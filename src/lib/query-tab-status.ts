import type { TabStatus } from '../stores/query-store'

const AI_LOCK_STATUSES: ReadonlySet<TabStatus> = new Set<TabStatus>(['ai-pending', 'ai-reviewing'])

const EDITOR_LOCK_STATUSES: ReadonlySet<TabStatus> = new Set<TabStatus>([
  'running',
  'ai-pending',
  'ai-reviewing',
])

export function isAiLockStatus(status: TabStatus): boolean {
  return AI_LOCK_STATUSES.has(status)
}

export function isEditorLockStatus(status: TabStatus): boolean {
  return EDITOR_LOCK_STATUSES.has(status)
}
