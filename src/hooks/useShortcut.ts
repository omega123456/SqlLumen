import { useEffect } from 'react'
import { useShortcutStore, EDITOR_CONTEXT_ACTIONS, GLOBAL_ACTIONS } from '../stores/shortcut-store'
import { bindingsMatch } from '../lib/shortcut-bindings'
import type { ShortcutBinding } from '../types/schema'
import { elementOf } from '../lib/input-events'

function eventToBinding(event: KeyboardEvent): ShortcutBinding {
  const modifiers: string[] = []

  if (event.ctrlKey || event.metaKey) modifiers.push('ctrl')
  if (event.shiftKey) modifiers.push('shift')
  if (event.altKey) modifiers.push('alt')

  if (event.key === '+') {
    const filteredModifiers = modifiers.filter((modifier) => modifier !== 'shift')
    return { key: '=', modifiers: filteredModifiers }
  }

  return { key: event.key, modifiers: modifiers }
}

function isInsideMonaco(): boolean {
  const active = document.activeElement
  if (!active) return false
  return !!active.closest('.monaco-editor')
}

const INPUT_TAG_NAMES = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

export function useShortcut(): void {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      const target = elementOf(event.target)
      const inMonaco = isInsideMonaco()
      const pressed = eventToBinding(event)

      const state = useShortcutStore.getState()
      const { shortcuts } = state

      if (state.recordingActionId !== null) return

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
