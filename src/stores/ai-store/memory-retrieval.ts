import { searchMemories } from '../../lib/ai-memory-commands'
import type { AiMemory, MemoryScope } from '../../lib/ai-memory-commands'
import { logFrontend } from '../../lib/app-log-commands'
import { estimateTokenCount } from '../../lib/schema-ddl-compactor'
import { toErrorMessage } from '../../lib/error-message'
import { useAiStore } from '../ai-store'

const MEMORY_SCOPE_ORDER: Record<MemoryScope, number> = {
  global: 0,
  group: 1,
  connection: 2,
}

export function memoryKey(memory: Pick<AiMemory, 'scope' | 'id'>): string {
  return `${memory.scope ?? 'connection'}-${memory.id}`
}

function sortMemoriesByScope(memories: AiMemory[]): AiMemory[] {
  return memories
    .map((memory, index) => ({ memory, index }))
    .sort((left, right) => {
      const scopeDiff =
        (MEMORY_SCOPE_ORDER[left.memory.scope] ?? MEMORY_SCOPE_ORDER.connection) -
        (MEMORY_SCOPE_ORDER[right.memory.scope] ?? MEMORY_SCOPE_ORDER.connection)
      if (scopeDiff !== 0) return scopeDiff
      return left.index - right.index
    })
    .map((entry) => entry.memory)
}

export const MEMORY_TOKEN_BUDGET = 500

const MEMORY_SEARCH_RESULT_LIMIT = 5

const MEMORY_SECTION_HEADER = '## User Notes (from memory)\n'

export async function retrieveMemories(
  sessionId: string,
  userMessage: string
): Promise<AiMemory[]> {
  try {
    logFrontend(
      'debug',
      `[ai-store] searching memories for context — sessionId=${sessionId} query="${userMessage}"`
    )
    const memoryResults = await searchMemories({
      sessionId: sessionId,
      query: userMessage,
      limit: MEMORY_SEARCH_RESULT_LIMIT,
    })
    const memories = sortMemoriesByScope(memoryResults)
    logFrontend(
      'debug',
      `[ai-store] memory search returned ${memories.length} result(s) — sessionId=${sessionId}`
    )
    return memories
  } catch (error) {
    const message = toErrorMessage(error)
    logFrontend('debug', `[ai-store] memory retrieval failed (non-fatal) — error="${message}"`)
    logFrontend('warn', `[ai-store] Memory retrieval failed (non-fatal): ${message}`)
    return []
  }
}

interface MemoryContext {
  text: string | null
  includedMemories: AiMemory[]
}

function buildNovelMemoryContext(novelMemories: AiMemory[]): MemoryContext {
  const memoryLines: string[] = []
  const includedMemories: AiMemory[] = []
  let usedTokens = estimateTokenCount(MEMORY_SECTION_HEADER)
  for (const memory of novelMemories) {
    const line = `- ${memory.content}`
    const lineTokens = estimateTokenCount(line)
    if (usedTokens + lineTokens > MEMORY_TOKEN_BUDGET) break
    memoryLines.push(line)
    includedMemories.push(memory)
    usedTokens += lineTokens
  }
  const text = memoryLines.length > 0 ? `${MEMORY_SECTION_HEADER}${memoryLines.join('\n')}` : null
  return { text: text, includedMemories: includedMemories }
}

export function selectNovelMemories(tabId: string, allMemories: AiMemory[]): MemoryContext {
  const existingMemoryIds = useAiStore.getState().tabs[tabId]?.providedMemoryIds ?? {}
  const novelMemories = allMemories.filter((memory) => !existingMemoryIds[memoryKey(memory)])
  const memoryContext = buildNovelMemoryContext(novelMemories)
  if (novelMemories.length > 0) {
    logFrontend(
      'debug',
      `[ai-store] memory retrieval complete — total=${allMemories.length} novel=${novelMemories.length} included=${memoryContext.includedMemories.length} budgetTokens=${MEMORY_TOKEN_BUDGET}`
    )
  }
  return memoryContext
}
