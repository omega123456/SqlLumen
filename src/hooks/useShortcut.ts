import { useEffect } from 'react'
import {
  useShortcutStore,
  EDITOR_CONTEXT_ACTIONS,
  GLOBAL_ACTIONS,
} from '../stores/shortcut-store'
import type { ShortcutBinding } from '../types/schema'

/** Normalize a keyboard event into a ShortcutBinding for matching. */
function eventToBinding(e: KeyboardEvent): ShortcutBinding {
  const modifiers: string[] = []

  // Treat both Ctrl and Meta as 'ctrl' (cross-platform: Cmd on macOS = Meta)
  if (e.ctrlKey || e.metaKey) modifiers.push('ctrl')
  if (e.shiftKey) modifiers.push('shift')
  if (e.altKey) modifiers.push('alt')

  // Normalize '+' (produced by Shift+=) to '=' and drop the shift modifier,
  // so both Cmd+= and Cmd+Shift+= match the zoom-in binding.
  if (e.key === '+') {
    const filteredModifiers = modifiers.filter((m) => m !== 'shift')
    return { key: '=', modifiers: filteredModifiers }
  }

  return { key: e.key, modifiers }
}

/** Check if two bindings match (case-insensitive key, sorted modifiers). */
function bindingsMatch(a: ShortcutBinding, b: ShortcutBinding): boolean {
  if (a.key.toLowerCase() !== b.key.toLowerCase()) return false
  const aMods = [...a.modifiers].sort()
  const bMods = [...b.modifiers].sort()
  if (aMods.length !== bMods.length) return false
  return aMods.every((mod, i) => mod === bMods[i])
}

/** Check if the active element is inside a Monaco editor. */
function isInsideMonaco(): boolean {
  const active = document.activeElement
  if (!active) return false
  return !!active.closest('.monaco-editor')
}

/** Elements where non-global shortcuts should NOT fire (user is typing). */
const INPUT_TAG_NAMES = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/**
 * Hook that attaches a global keydown listener to dispatch registered
 * shortcut actions from the shortcut store.
 *
 * Call this once at the app root level. Components register their action
 * callbacks via `useShortcutStore.getState().registerAction(id, fn)`.
 */
export function useShortcut(): void {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      const target = e.target as HTMLElement | null
      const inMonaco = isInsideMonaco()
      const pressed = eventToBinding(e)

      const state = useShortcutStore.getState()
      const { shortcuts } = state

      // Don't dispatch shortcuts while a binding is being recorded
      if (state.recordingActionId !== null) return

      // Find matching action
      let matchedActionId: string | null = null
      for (const [actionId, binding] of Object.entries(shortcuts)) {
        if (bindingsMatch(pressed, binding)) {
          matchedActionId = actionId
          break
        }
      }

      if (!matchedActionId) return

      // If target is an input element, only allow global actions
      if (target && INPUT_TAG_NAMES.has(target.tagName) && !GLOBAL_ACTIONS.has(matchedActionId)) {
        return
      }

      // If inside Monaco, only allow editor-context actions
      if (inMonaco && !EDITOR_CONTEXT_ACTIONS.has(matchedActionId)) {
        return
      }

      e.preventDefault()
      e.stopPropagation()
      state.dispatchAction(matchedActionId)
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [])
}
