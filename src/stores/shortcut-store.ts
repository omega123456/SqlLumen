import { create } from 'zustand'
import { getSetting } from '../lib/tauri-commands'
import type { ShortcutBinding } from '../types/schema'

// ---------------------------------------------------------------------------
// Default shortcut bindings
// ---------------------------------------------------------------------------

export const DEFAULT_SHORTCUTS: Record<string, ShortcutBinding> = {
  'execute-query': { key: 'F9', modifiers: [] },
  'execute-all': { key: 'Enter', modifiers: ['ctrl', 'shift'] },
  'format-query': { key: 'F12', modifiers: [] },
  'save-file': { key: 'S', modifiers: ['ctrl'] },
  'open-file': { key: 'O', modifiers: ['ctrl'] },
  'new-query-tab': { key: 'T', modifiers: ['ctrl'] },
  'close-tab': { key: 'W', modifiers: ['ctrl'] },
  settings: { key: ',', modifiers: ['ctrl'] },
}

/** Action IDs that should fire even when the Monaco editor is focused. */
export const EDITOR_CONTEXT_ACTIONS = new Set(['execute-query', 'execute-all', 'format-query'])

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

type ActionCallback = () => void

interface ShortcutState {
  /** Current shortcut bindings keyed by action ID. */
  shortcuts: Record<string, ShortcutBinding>
  /** Default shortcut bindings (immutable reference). */
  defaults: Record<string, ShortcutBinding>
  /** Action ID currently being re-recorded (null when not recording). */
  recordingActionId: string | null
  /** Action ID that conflicts with a pending recording (null when no conflict). */
  conflictActionId: string | null
  /** Pending binding stashed during conflict resolution. */
  _pendingBinding: ShortcutBinding | null
  /** Pending action ID stashed during conflict resolution. */
  _pendingActionId: string | null
  /** Mutable registry of action callbacks (not part of reactive state). */
  _actions: Record<string, ActionCallback>

  // Actions
  initializeFromBackend: () => Promise<void>
  loadShortcuts: (serialized?: string) => void
  saveShortcuts: () => string
  startRecording: (actionId: string) => void
  finishRecording: (actionId: string, binding: ShortcutBinding) => void
  cancelRecording: () => void
  resolveConflict: () => void
  resetShortcut: (actionId: string) => void
  resetAllShortcuts: () => void
  registerAction: (actionId: string, callback: ActionCallback) => void
  unregisterAction: (actionId: string) => void
  dispatchAction: (actionId: string) => void
}

/** Check if two bindings are the same key combo. */
function bindingsMatch(a: ShortcutBinding, b: ShortcutBinding): boolean {
  if (a.key.toLowerCase() !== b.key.toLowerCase()) return false
  const aMods = [...a.modifiers].sort()
  const bMods = [...b.modifiers].sort()
  if (aMods.length !== bMods.length) return false
  return aMods.every((mod, i) => mod === bMods[i])
}

/** Find an action ID that already uses a given binding (excluding `excludeActionId`). */
function findConflict(
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

export const useShortcutStore = create<ShortcutState>()((set, get) => ({
  shortcuts: { ...DEFAULT_SHORTCUTS },
  defaults: DEFAULT_SHORTCUTS,
  recordingActionId: null,
  conflictActionId: null,
  _pendingBinding: null,
  _pendingActionId: null,
  _actions: {},

  initializeFromBackend: async () => {
    try {
      const serialized = await getSetting('shortcuts')
      get().loadShortcuts(serialized ?? undefined)
    } catch (error) {
      console.error('[shortcut-store] Failed to load shortcuts from backend:', error)
    }
  },

  loadShortcuts: (serialized?: string) => {
    if (!serialized || serialized === '{}') {
      set({ shortcuts: { ...DEFAULT_SHORTCUTS } })
      return
    }
    try {
      const parsed = JSON.parse(serialized) as Record<string, ShortcutBinding>
      // Merge: use parsed values where available, defaults otherwise
      const merged = { ...DEFAULT_SHORTCUTS }
      for (const [actionId, binding] of Object.entries(parsed)) {
        if (actionId in merged && binding && typeof binding.key === 'string') {
          merged[actionId] = binding
        }
      }
      set({ shortcuts: merged })
    } catch (error) {
      console.error('[shortcut-store] Failed to parse shortcuts:', error)
      set({ shortcuts: { ...DEFAULT_SHORTCUTS } })
    }
  },

  saveShortcuts: (): string => {
    const state = get()
    return JSON.stringify(state.shortcuts)
  },

  startRecording: (actionId: string) => {
    set({ recordingActionId: actionId, conflictActionId: null })
  },

  finishRecording: (actionId: string, binding: ShortcutBinding) => {
    const state = get()
    const conflict = findConflict(state.shortcuts, binding, actionId)
    if (conflict) {
      set({
        conflictActionId: conflict,
        _pendingBinding: binding,
        _pendingActionId: actionId,
        recordingActionId: null,
      })
      return
    }
    const updated = { ...state.shortcuts, [actionId]: binding }
    set({
      shortcuts: updated,
      recordingActionId: null,
      conflictActionId: null,
      _pendingBinding: null,
      _pendingActionId: null,
    })
  },

  cancelRecording: () => {
    set({
      recordingActionId: null,
      conflictActionId: null,
      _pendingBinding: null,
      _pendingActionId: null,
    })
  },

  resolveConflict: () => {
    const state = get()
    if (!state._pendingBinding || !state._pendingActionId || !state.conflictActionId) return

    const updated = { ...state.shortcuts }
    // Assign the pending binding to the intended action
    updated[state._pendingActionId] = state._pendingBinding
    // Reset the conflicting action to its default
    updated[state.conflictActionId] = DEFAULT_SHORTCUTS[state.conflictActionId] ?? {
      key: '',
      modifiers: [],
    }

    set({
      shortcuts: updated,
      conflictActionId: null,
      _pendingBinding: null,
      _pendingActionId: null,
      recordingActionId: null,
    })
  },

  resetShortcut: (actionId: string) => {
    const state = get()
    if (actionId in DEFAULT_SHORTCUTS) {
      set({
        shortcuts: { ...state.shortcuts, [actionId]: DEFAULT_SHORTCUTS[actionId] },
      })
    }
  },

  resetAllShortcuts: () => {
    set({ shortcuts: { ...DEFAULT_SHORTCUTS } })
  },

  registerAction: (actionId: string, callback: ActionCallback) => {
    const state = get()
    state._actions[actionId] = callback
  },

  unregisterAction: (actionId: string) => {
    const state = get()
    delete state._actions[actionId]
  },

  dispatchAction: (actionId: string) => {
    const state = get()
    const callback = state._actions[actionId]
    if (callback) callback()
  },
}))
