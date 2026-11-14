import type { AiMessage, AiState } from '../ai-store'

export function buildAttachedContextMessage(sql: string): string {
  return `The following SQL statement is the context for this conversation:\n\n\`\`\`sql\n${sql}\n\`\`\``
}

export function isPromptOnlyContextMessage(message: AiMessage): boolean {
  return (
    message.kind === 'schema-context' ||
    message.kind === 'attached-context' ||
    message.kind === 'memory-context'
  )
}

export type AiStreamDone = Parameters<AiState['onStreamDone']>[2]

export type ContextMessageDraft = Pick<AiMessage, 'role' | 'content' | 'kind'>

const TURN_CONTEXT_KINDS = new Set<string>(['schema-context', 'memory-context', 'attached-context'])

const REMOVABLE_TURN_CONTEXT_KINDS = new Set<string>(['schema-context', 'memory-context'])

export function isBaseSystemMessage(message: AiMessage): boolean {
  return message.role === 'system' && !isPromptOnlyContextMessage(message)
}

export function findBaseSystemPrompt(messages: AiMessage[]): string {
  const systemMessage = messages.find(isBaseSystemMessage)
  return systemMessage?.content ?? ''
}

function indicesOfKind(messages: AiMessage[], kind: AiMessage['kind']): number[] {
  const indices: number[] = []
  messages.forEach((message, index) => {
    if (message.kind === kind) indices.push(index)
  })
  return indices
}

function isSameContextMessage(existing: AiMessage, draft: ContextMessageDraft): boolean {
  return existing.role === draft.role && existing.content === draft.content
}

export function upsertContextMessage(
  messages: AiMessage[],
  userIndex: number,
  draft: ContextMessageDraft
): boolean {
  if (!draft.kind) return false
  const [primaryIndex, ...duplicateIndices] = indicesOfKind(messages, draft.kind)
  for (const duplicateIndex of duplicateIndices.reverse()) {
    messages.splice(duplicateIndex, 1)
  }
  const removedDuplicates = duplicateIndices.length > 0

  if (primaryIndex === undefined) {
    messages.splice(userIndex, 0, {
      id: crypto.randomUUID(),
      role: draft.role,
      content: draft.content,
      timestamp: Date.now(),
      kind: draft.kind,
    })
    return true
  }

  const existingMessage = messages[primaryIndex]
  if (isSameContextMessage(existingMessage, draft)) return removedDuplicates
  messages[primaryIndex] = {
    ...existingMessage,
    role: draft.role,
    content: draft.content,
    timestamp: Date.now(),
    kind: draft.kind,
  }
  return true
}

function isTurnContextMessage(message: AiMessage): boolean {
  return message.kind !== undefined && TURN_CONTEXT_KINDS.has(message.kind)
}

export function findRemovableTurnContextIndices(
  messages: AiMessage[],
  userIndex: number
): number[] {
  const indices: number[] = []
  for (let scanIndex = userIndex - 1; scanIndex >= 0; scanIndex--) {
    const message = messages[scanIndex]
    if (!isTurnContextMessage(message)) break
    if (REMOVABLE_TURN_CONTEXT_KINDS.has(message.kind ?? '')) {
      indices.push(scanIndex)
    }
  }
  return indices
}

interface RemovedContextIds {
  chunkKeys: string[]
  memoryIds: string[]
}

export function collectRemovedContextIds(
  messages: AiMessage[],
  indices: number[]
): RemovedContextIds {
  const removed: RemovedContextIds = { chunkKeys: [], memoryIds: [] }
  for (const index of indices) {
    const message = messages[index]
    if (message.kind === 'schema-context') {
      removed.chunkKeys.push(...(message.chunkKeys ?? []))
    }
    if (message.kind === 'memory-context') {
      removed.memoryIds.push(...(message.memoryIds ?? []))
    }
  }
  return removed
}

export function withoutKeys(record: Record<string, true>, keys: string[]): Record<string, true> {
  const remaining = { ...record }
  for (const key of keys) {
    delete remaining[key]
  }
  return remaining
}

export function withKeys(record: Record<string, true>, keys: string[]): Record<string, true> {
  const extended = { ...record }
  for (const key of keys) {
    extended[key] = true
  }
  return extended
}
