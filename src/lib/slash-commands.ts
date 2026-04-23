import { saveMemory } from './ai-memory-commands'
import { showSuccessToast, showErrorToast } from '../stores/toast-store'
import { logFrontend } from './app-log-commands'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SlashCommand {
  name: string
  description: string
  execute: (args: string, sessionId: string) => Promise<void>
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: 'remember',
    description: 'Save a note to memory',
    execute: async (args: string, sessionId: string) => {
      const trimmed = args.trim()
      if (!trimmed) {
        showErrorToast('Please provide text to remember')
        throw new Error('Cannot save empty memory. Usage: /remember <text>')
      }
      try {
        await saveMemory({ sessionId, content: trimmed })
        showSuccessToast('Memory saved')
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        logFrontend('error', `[slash-commands] /remember failed: ${msg}`)
        showErrorToast('Failed to save memory', msg)
        throw err
      }
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
