import { useEffect } from 'react'
import { useShortcutStore, EDITOR_CONTEXT_ACTIONS, GLOBAL_ACTIONS } from '../stores/shortcut-store'
import { bindingsMatch } from '../lib/shortcut-bindings'
import type { ShortcutBinding } from '../types/schema'
import { elementOf } from '../lib/input-events'

/** Normalize a keyboard event into a ShortcutBinding for matching. */
function eventToBinding(event: KeyboardEvent): ShortcutBinding {
  const modifiers: string[] = []

  // Treat both Ctrl and Meta as 'ctrl' (cross-platform: Cmd on macOS = Meta)
  if (event.ctrlKey || event.metaKey) modifiers.push('ctrl')
  if (event.shiftKey) modifiers.push('shift')
  if (event.altKey) modifiers.push('alt')

  // Normalize '+' (produced by Shift+=) to '=' and drop the shift modifier,
  // so both Cmd+= and Cmd+Shift+= match the zoom-in binding.
  if (event.key === '+') {
    const filteredModifiers = modifiers.filter((modifier) => modifier !== 'shift')
    return { key: '=', modifiers: filteredModifiers }
  }

  return { key: event.key, modifiers: modifiers }
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
    function handleKeyDown(event: KeyboardEvent): void {
      const target = elementOf(event.target)
      const inMonaco = isInsideMonaco()
      const pressed = eventToBinding(event)

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

      const isInputTarget = target !== null && INPUT_TAG_NAMES.has(target.tagName)
      const isBlockedInInput = isInputTarget && !GLOBAL_ACTIONS.has(matchedActionId)
      if (isBlockedInInput) {
        return
      }

      const isBlockedInEditor = inMonaco && !EDITOR_CONTEXT_ACTIONS.has(matchedActionId)
      if (isBlockedInEditor) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      state.dispatchAction(matchedActionId)
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [])
}
