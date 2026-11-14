import { create } from 'zustand'
import { bindingsMatch } from '../lib/shortcut-bindings'
import { getSetting } from '../lib/tauri-commands'
import type { ShortcutBinding } from '../types/schema'

import { logFrontendError } from '../lib/app-log-commands'

export const DEFAULT_SHORTCUTS: Record<string, ShortcutBinding> = {
  'execute-query': { key: 'F9', modifiers: [] },
  'execute-all': { key: 'Enter', modifiers: ['ctrl', 'shift'] },
  'format-query': { key: 'F12', modifiers: [] },
  'command-palette': { key: 'F2', modifiers: [] },
  'command-palette-table': { key: 'F2', modifiers: ['shift'] },
  'save-file': { key: 'S', modifiers: ['ctrl'] },
  'open-file': { key: 'O', modifiers: ['ctrl'] },
  'new-query-tab': { key: 'T', modifiers: ['ctrl'] },
  'close-tab': { key: 'W', modifiers: ['ctrl'] },
  settings: { key: ',', modifiers: ['ctrl'] },
  'zoom-in': { key: '=', modifiers: ['ctrl'] },
  'zoom-out': { key: '-', modifiers: ['ctrl'] },
  'zoom-reset': { key: '0', modifiers: ['ctrl'] },
  'reveal-in-object-browser': { key: 'F1', modifiers: ['shift'] },
}

export const EDITOR_CONTEXT_ACTIONS = new Set([
  'execute-query',
  'execute-all',
  'format-query',
  'command-palette',
  'command-palette-table',
  'new-query-tab',
  'zoom-in',
  'zoom-out',
  'zoom-reset',
  'reveal-in-object-browser',
])

export const GLOBAL_ACTIONS = new Set([
  'command-palette',
  'command-palette-table',
  'zoom-in',
  'zoom-out',
  'zoom-reset',
  'reveal-in-object-browser',
])

type ActionCallback = () => void

interface ShortcutState {
  shortcuts: Record<string, ShortcutBinding>
  defaults: Record<string, ShortcutBinding>
  recordingActionId: string | null
  conflictActionId: string | null
  _pendingBinding: ShortcutBinding | null
  _pendingActionId: string | null
  _actions: Record<string, ActionCallback>

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

const EMPTY_SERIALIZED_SHORTCUTS = '{}'

function isKnownShortcutBinding(
  shortcuts: Record<string, ShortcutBinding>,
  actionId: string,
  binding: ShortcutBinding | null | undefined
): boolean {
  if (!(actionId in shortcuts)) return false
  if (!binding) return false
  return typeof binding.key === 'string'
}

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

async function initializeFromBackend(): Promise<void> {
  try {
    const serialized = await getSetting('shortcuts')
    useShortcutStore.getState().loadShortcuts(serialized ?? undefined)
  } catch (error) {
    logFrontendError('[shortcut-store] Failed to load shortcuts from backend:', error)
  }
}

function mergeWithDefaultShortcuts(
  parsed: Record<string, ShortcutBinding>
): typeof DEFAULT_SHORTCUTS {
  const merged = { ...DEFAULT_SHORTCUTS }
  for (const [actionId, binding] of Object.entries(parsed)) {
    if (isKnownShortcutBinding(merged, actionId, binding)) {
      merged[actionId] = binding
    }
  }
  return merged
}

function loadShortcuts(serialized?: string): void {
  const hasNoSavedShortcuts = !serialized || serialized === EMPTY_SERIALIZED_SHORTCUTS
  if (hasNoSavedShortcuts) {
    useShortcutStore.setState({ shortcuts: { ...DEFAULT_SHORTCUTS } })
    return
  }
  try {
    const parsed = JSON.parse(serialized) as Record<string, ShortcutBinding>
    useShortcutStore.setState({ shortcuts: mergeWithDefaultShortcuts(parsed) })
  } catch (error) {
    logFrontendError('[shortcut-store] Failed to parse shortcuts:', error)
    useShortcutStore.setState({ shortcuts: { ...DEFAULT_SHORTCUTS } })
  }
}

function saveShortcuts(): string {
  const state = useShortcutStore.getState()
  return JSON.stringify(state.shortcuts)
}

function startRecording(actionId: string): void {
  useShortcutStore.setState({ recordingActionId: actionId, conflictActionId: null })
}

function finishRecording(actionId: string, binding: ShortcutBinding): void {
  const state = useShortcutStore.getState()
  const conflict = findConflict(state.shortcuts, binding, actionId)
  if (conflict) {
    useShortcutStore.setState({
      conflictActionId: conflict,
      _pendingBinding: binding,
      _pendingActionId: actionId,
      recordingActionId: null,
    })
    return
  }
  const updated = { ...state.shortcuts, [actionId]: binding }
  useShortcutStore.setState({
    shortcuts: updated,
    recordingActionId: null,
    conflictActionId: null,
    _pendingBinding: null,
    _pendingActionId: null,
  })
}

function cancelRecording(): void {
  useShortcutStore.setState({
    recordingActionId: null,
    conflictActionId: null,
    _pendingBinding: null,
    _pendingActionId: null,
  })
}

function resolveConflict(): void {
  const state = useShortcutStore.getState()
  if (!state._pendingBinding) return
  if (!state._pendingActionId) return
  if (!state.conflictActionId) return

  const updated = { ...state.shortcuts }
  updated[state._pendingActionId] = state._pendingBinding
  updated[state.conflictActionId] = DEFAULT_SHORTCUTS[state.conflictActionId] ?? {
    key: '',
    modifiers: [],
  }

  useShortcutStore.setState({
    shortcuts: updated,
    conflictActionId: null,
    _pendingBinding: null,
    _pendingActionId: null,
    recordingActionId: null,
  })
}

function resetShortcut(actionId: string): void {
  const state = useShortcutStore.getState()
  if (actionId in DEFAULT_SHORTCUTS) {
    useShortcutStore.setState({
      shortcuts: { ...state.shortcuts, [actionId]: DEFAULT_SHORTCUTS[actionId] },
    })
  }
}

function resetAllShortcuts(): void {
  useShortcutStore.setState({ shortcuts: { ...DEFAULT_SHORTCUTS } })
}

function registerAction(actionId: string, callback: ActionCallback): void {
  const state = useShortcutStore.getState()
  state._actions[actionId] = callback
}

function unregisterAction(actionId: string): void {
  const state = useShortcutStore.getState()
  delete state._actions[actionId]
}

function dispatchAction(actionId: string): void {
  const state = useShortcutStore.getState()
  const callback = state._actions[actionId]
  if (callback) callback()
}

export const useShortcutStore = create<ShortcutState>()(() => ({
  shortcuts: { ...DEFAULT_SHORTCUTS },
  defaults: DEFAULT_SHORTCUTS,
  recordingActionId: null,
  conflictActionId: null,
  _pendingBinding: null,
  _pendingActionId: null,
  _actions: {},
  initializeFromBackend: initializeFromBackend,
  loadShortcuts: loadShortcuts,
  saveShortcuts: saveShortcuts,
  startRecording: startRecording,
  finishRecording: finishRecording,
  cancelRecording: cancelRecording,
  resolveConflict: resolveConflict,
  resetShortcut: resetShortcut,
  resetAllShortcuts: resetAllShortcuts,
  registerAction: registerAction,
  unregisterAction: unregisterAction,
  dispatchAction: dispatchAction,
}))
