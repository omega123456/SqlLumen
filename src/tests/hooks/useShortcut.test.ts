import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useShortcut } from '../../hooks/useShortcut'
import { useShortcutStore, DEFAULT_SHORTCUTS } from '../../stores/shortcut-store'

function fireKeydown(
  key: string,
  options: { ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean } = {},
  target?: HTMLElement
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    ctrlKey: options.ctrlKey ?? false,
    shiftKey: options.shiftKey ?? false,
    altKey: options.altKey ?? false,
    metaKey: options.metaKey ?? false,
    bubbles: true,
    cancelable: true,
  })

  // Override target if provided
  if (target) {
    Object.defineProperty(event, 'target', { value: target, writable: false })
  }

  window.dispatchEvent(event)
  return event
}

beforeEach(() => {
  // Reset shortcut store
  useShortcutStore.setState({
    shortcuts: { ...DEFAULT_SHORTCUTS },
    recordingActionId: null,
    conflictActionId: null,
    _pendingBinding: null,
    _pendingActionId: null,
    _actions: {},
  })
})

afterEach(() => {
  // Clean up any registered actions
  const state = useShortcutStore.getState()
  for (const key of Object.keys(state._actions)) {
    delete state._actions[key]
  }
})

describe('useShortcut', () => {
  it('dispatches registered action on matching keydown', () => {
    const callback = vi.fn()
    useShortcutStore.getState().registerAction('execute-query', callback)

    const { unmount } = renderHook(() => useShortcut())

    fireKeydown('F9')
    expect(callback).toHaveBeenCalledTimes(1)

    unmount()
  })

  it('does NOT fire when typing in an INPUT element', () => {
    const callback = vi.fn()
    useShortcutStore.getState().registerAction('execute-query', callback)

    const { unmount } = renderHook(() => useShortcut())

    const input = document.createElement('input')
    document.body.appendChild(input)
    fireKeydown('F9', {}, input)

    expect(callback).not.toHaveBeenCalled()

    document.body.removeChild(input)
    unmount()
  })

  it('does NOT fire when typing in a TEXTAREA element', () => {
    const callback = vi.fn()
    useShortcutStore.getState().registerAction('execute-query', callback)

    const { unmount } = renderHook(() => useShortcut())

    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    fireKeydown('F9', {}, textarea)

    expect(callback).not.toHaveBeenCalled()

    document.body.removeChild(textarea)
    unmount()
  })

  it('does NOT fire when typing in a SELECT element', () => {
    const callback = vi.fn()
    useShortcutStore.getState().registerAction('execute-query', callback)

    const { unmount } = renderHook(() => useShortcut())

    const select = document.createElement('select')
    document.body.appendChild(select)
    fireKeydown('F9', {}, select)

    expect(callback).not.toHaveBeenCalled()

    document.body.removeChild(select)
    unmount()
  })

  it('fires editor-context shortcuts when Monaco editor is focused', () => {
    const callback = vi.fn()
    useShortcutStore.getState().registerAction('execute-query', callback)

    const { unmount } = renderHook(() => useShortcut())

    // Create a mock Monaco editor container
    const monacoContainer = document.createElement('div')
    monacoContainer.classList.add('monaco-editor')
    const innerElement = document.createElement('div')
    monacoContainer.appendChild(innerElement)
    document.body.appendChild(monacoContainer)

    // Focus the inner element
    Object.defineProperty(document, 'activeElement', {
      value: innerElement,
      configurable: true,
    })

    fireKeydown('F9')
    expect(callback).toHaveBeenCalledTimes(1)

    // Cleanup
    Object.defineProperty(document, 'activeElement', {
      value: document.body,
      configurable: true,
    })
    document.body.removeChild(monacoContainer)
    unmount()
  })

  it('does NOT fire non-editor-context shortcuts when Monaco editor is focused', () => {
    const callback = vi.fn()
    useShortcutStore.getState().registerAction('settings', callback)

    const { unmount } = renderHook(() => useShortcut())

    // Create a mock Monaco editor container
    const monacoContainer = document.createElement('div')
    monacoContainer.classList.add('monaco-editor')
    const innerElement = document.createElement('div')
    monacoContainer.appendChild(innerElement)
    document.body.appendChild(monacoContainer)

    Object.defineProperty(document, 'activeElement', {
      value: innerElement,
      configurable: true,
    })

    fireKeydown(',', { ctrlKey: true })
    expect(callback).not.toHaveBeenCalled()

    // Cleanup
    Object.defineProperty(document, 'activeElement', {
      value: document.body,
      configurable: true,
    })
    document.body.removeChild(monacoContainer)
    unmount()
  })

  it('handles modifier key combos correctly', () => {
    const callback = vi.fn()
    useShortcutStore.getState().registerAction('save-file', callback)

    const { unmount } = renderHook(() => useShortcut())

    // Ctrl+S should match save-file
    fireKeydown('S', { ctrlKey: true })
    expect(callback).toHaveBeenCalledTimes(1)

    unmount()
  })

  it('does not match when modifier keys are wrong', () => {
    const callback = vi.fn()
    useShortcutStore.getState().registerAction('save-file', callback)

    const { unmount } = renderHook(() => useShortcut())

    // Just pressing S without Ctrl should NOT match save-file
    fireKeydown('S')
    expect(callback).not.toHaveBeenCalled()

    unmount()
  })

  it('cleans up listener on unmount', () => {
    const callback = vi.fn()
    useShortcutStore.getState().registerAction('execute-query', callback)

    const { unmount } = renderHook(() => useShortcut())
    unmount()

    fireKeydown('F9')
    expect(callback).not.toHaveBeenCalled()
  })
})
