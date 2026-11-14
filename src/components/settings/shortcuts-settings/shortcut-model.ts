import { logParseFallback } from '../../../lib/app-log-commands'
import { bindingsMatch } from '../../../lib/shortcut-bindings'
import { DEFAULT_SHORTCUTS } from '../../../stores/shortcut-store'
import type { ShortcutBinding, ShortcutActionDescriptor } from '../../../types/schema'

const MODIFIER_KEYS: ReadonlySet<string> = new Set(['Control', 'Shift', 'Alt', 'Meta'])
const UNASSIGNED_BINDING: ShortcutBinding = { key: '', modifiers: [] }

export type ShortcutMap = Record<string, ShortcutBinding>

export const ACTION_DESCRIPTORS: ShortcutActionDescriptor[] = [
  { id: 'execute-query', label: 'Execute query', description: 'Run the current SQL statement' },
  {
    id: 'execute-all',
    label: 'Execute all',
    description: 'Run all statements in the editor',
  },
  { id: 'format-query', label: 'Format query', description: 'Auto-format the current SQL' },
  {
    id: 'command-palette',
    label: 'Command palette',
    description: 'Open the schema object search palette',
  },
  {
    id: 'command-palette-table',
    label: 'Search table columns',
    description: 'Open the command palette scoped to the active table',
  },
  { id: 'save-file', label: 'Save file', description: 'Save the current editor contents' },
  { id: 'open-file', label: 'Open file', description: 'Open a SQL file' },
  { id: 'new-query-tab', label: 'New query tab', description: 'Open a new query editor tab' },
  { id: 'close-tab', label: 'Close tab', description: 'Close the active workspace tab' },
  { id: 'settings', label: 'Settings', description: 'Open the settings dialog' },
  { id: 'zoom-in', label: 'Zoom in', description: 'Increase application zoom level' },
  { id: 'zoom-out', label: 'Zoom out', description: 'Decrease application zoom level' },
  { id: 'zoom-reset', label: 'Reset zoom', description: 'Reset application zoom to 100%' },
  {
    id: 'reveal-in-object-browser',
    label: 'Reveal in object browser',
    description: "Select the active tab's table, view or routine in the object browser",
  },
]

export function findConflict(
  shortcuts: Record<string, ShortcutBinding>,
  binding: ShortcutBinding,
  excludeActionId: string
): string | null {
  for (const [actionId, existing] of Object.entries(shortcuts)) {
    if (actionId === excludeActionId) continue
    if (bindingsMatch(existing, binding)) return actionId
  }
  return null
}

function isShortcutOverride(
  actionId: string,
  binding: ShortcutBinding | null
): binding is ShortcutBinding {
  return actionId in DEFAULT_SHORTCUTS && typeof binding?.key === 'string'
}

function mergeOntoDefaultShortcuts(
  storedShortcuts: Record<string, ShortcutBinding | null>
): Record<string, ShortcutBinding> {
  const merged = { ...DEFAULT_SHORTCUTS }
  for (const [actionId, binding] of Object.entries(storedShortcuts)) {
    if (isShortcutOverride(actionId, binding)) {
      merged[actionId] = binding
    }
  }
  return merged
}

export function parsePendingShortcuts(
  pendingShortcuts: string | undefined
): Record<string, ShortcutBinding> | null {
  if (!pendingShortcuts) return null
  try {
    return mergeOntoDefaultShortcuts(JSON.parse(pendingShortcuts))
  } catch (error) {
    logParseFallback('[shortcuts-settings] parsePendingShortcuts', error)
    return null
  }
}

export interface ShortcutConflict {
  conflictActionId: string
  pendingActionId: string
  pendingBinding: ShortcutBinding
}

export interface RecordingSession {
  recordingActionId: string | null
  conflict: ShortcutConflict | null
}

export const IDLE_RECORDING: RecordingSession = { recordingActionId: null, conflict: null }

export function isModifierKey(key: string): boolean {
  return MODIFIER_KEYS.has(key)
}

export function bindingFromKeyEvent(event: KeyboardEvent): ShortcutBinding {
  const modifiers: string[] = []
  if (event.ctrlKey || event.metaKey) modifiers.push('ctrl')
  if (event.shiftKey) modifiers.push('shift')
  if (event.altKey) modifiers.push('alt')
  return { key: event.key, modifiers: modifiers }
}

export function withConflictReassigned(
  shortcuts: ShortcutMap,
  conflict: ShortcutConflict
): ShortcutMap {
  return {
    ...shortcuts,
    [conflict.pendingActionId]: conflict.pendingBinding,
    [conflict.conflictActionId]: DEFAULT_SHORTCUTS[conflict.conflictActionId] ?? UNASSIGNED_BINDING,
  }
}

export function isModifiedShortcut(shortcuts: ShortcutMap, actionId: string): boolean {
  const current = shortcuts[actionId]
  const defaultBinding = DEFAULT_SHORTCUTS[actionId]
  if (!current) return false
  if (!defaultBinding) return false
  return !bindingsMatch(current, defaultBinding)
}

export function defaultBindingLabel(actionId: string): string {
  const defaultBinding = DEFAULT_SHORTCUTS[actionId]
  const modifierSeparator = defaultBinding?.modifiers.length ? '+' : ''
  return `${defaultBinding?.modifiers.join('+')}${modifierSeparator}${defaultBinding?.key}`
}
