import { saveMemory } from './ai-memory-commands'
import type { AiMemory, MemoryScope } from './ai-memory-commands'
import { showSuccessToast, showErrorToast } from '../stores/toast-store'
import { useSettingsStore } from '../stores/settings-store'

import { logFrontend } from './app-log-commands'
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SlashCommand {
  name: string
  description: string
  execute: (args: string, sessionId: string) => Promise<void>
}

/**
 * The scope value resolved from the `ai.rememberScope` setting. `'ask'` is a
 * sentinel meaning "prompt the user for a scope" and is never passed to the
 * backend.
 */
export type RememberScopeSetting = MemoryScope | 'ask'

/**
 * Outcome of running `/remember`. The caller (AiChatInput) branches on `type`:
 * - `saved`  — the memory was persisted at the resolved scope.
 * - `ask`    — the resolved scope is "Always ask"; the caller must show a
 *              level picker and call `executeRemember` again with an explicit
 *              scope. Nothing was saved.
 */
export type RememberResult =
  | { type: 'saved'; memory: AiMemory }
  | { type: 'ask'; content: string }

// ---------------------------------------------------------------------------
// Scope resolution
// ---------------------------------------------------------------------------

/** Read the effective default `/remember` scope from the settings store. */
export function resolveRememberScope(): RememberScopeSetting {
  const value = useSettingsStore.getState().getSetting('ai.rememberScope')
  if (value === 'group' || value === 'global' || value === 'ask') {
    return value
  }
  return 'connection'
}

/**
 * Scope-aware `/remember` execution.
 *
 * Resolution order:
 * 1. If the caller passes an explicit `scope`, that wins.
 * 2. Otherwise read `ai.rememberScope` from the settings store.
 *
 * When the resolved scope is `'ask'` this does NOT save — it returns an
 * `{ type: 'ask' }` result so the caller can show a level picker. Otherwise it
 * calls `saveMemory` and toasts success/failure.
 */
export async function executeRemember(
  args: string,
  sessionId: string,
  scope?: MemoryScope
): Promise<RememberResult> {
  const trimmed = args.trim()
  if (!trimmed) {
    showErrorToast('Please provide text to remember')
    throw new Error('Cannot save empty memory. Usage: /remember <text>')
  }

  const resolved: RememberScopeSetting = scope ?? resolveRememberScope()

  if (resolved === 'ask') {
    return { type: 'ask', content: trimmed }
  }

  try {
    const memory = await saveMemory({ sessionId, content: trimmed, scope: resolved })
    showSuccessToast('Memory saved')
    return { type: 'saved', memory }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logFrontend('error', `[slash-commands] /remember failed: ${msg}`)
    showErrorToast('Failed to save memory', msg)
    throw err
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: 'remember',
    description: 'Save a note to memory',
    // Backward-compatible thin wrapper: resolves the scope from settings.
    // When the resolved scope is "ask" the caller is expected to use
    // `executeRemember` directly to drive the picker; here we simply no-op the
    // save (the caller's ask-flow handles it).
    execute: async (args: string, sessionId: string) => {
      await executeRemember(args, sessionId)
    },
  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function listCommands(): SlashCommand[] {
  return SLASH_COMMANDS
}

export function filterCommands(prefix: string): SlashCommand[] {
  const lower = prefix.toLowerCase()
  return SLASH_COMMANDS.filter((cmd) => cmd.name.toLowerCase().startsWith(lower))
}

export function findCommand(name: string): SlashCommand | undefined {
  return SLASH_COMMANDS.find((cmd) => cmd.name === name)
}
