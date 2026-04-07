import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
import { useShortcutStore, DEFAULT_SHORTCUTS } from '../../stores/shortcut-store'

let mockGetSettingResult: string | null = null

beforeEach(() => {
  // Reset store to initial state
  useShortcutStore.setState({
    shortcuts: { ...DEFAULT_SHORTCUTS },
    recordingActionId: null,
    conflictActionId: null,
    _pendingBinding: null,
    _pendingActionId: null,
    _actions: {},
  })

  mockGetSettingResult = null

  mockIPC((cmd) => {
    if (cmd === 'get_setting') return mockGetSettingResult
    if (cmd === 'log_frontend') return undefined
    throw new Error(`[vitest] Unmocked Tauri IPC command: ${cmd}`)
  })
})

describe('useShortcutStore', () => {
  describe('defaults', () => {
    it('has correct default shortcuts loaded', () => {
      const state = useShortcutStore.getState()
      expect(state.shortcuts['execute-query']).toEqual({ key: 'F9', modifiers: [] })
      expect(state.shortcuts['execute-all']).toEqual({
        key: 'Enter',
        modifiers: ['ctrl', 'shift'],
      })
      expect(state.shortcuts['format-query']).toEqual({ key: 'F12', modifiers: [] })
      expect(state.shortcuts['save-file']).toEqual({ key: 'S', modifiers: ['ctrl'] })
      expect(state.shortcuts['open-file']).toEqual({ key: 'O', modifiers: ['ctrl'] })
      expect(state.shortcuts['new-query-tab']).toEqual({ key: 'T', modifiers: ['ctrl'] })
      expect(state.shortcuts['close-tab']).toEqual({ key: 'W', modifiers: ['ctrl'] })
      expect(state.shortcuts['settings']).toEqual({ key: ',', modifiers: ['ctrl'] })
    })

    it('defaults are a separate reference from shortcuts', () => {
      const state = useShortcutStore.getState()
      expect(state.defaults).toBe(DEFAULT_SHORTCUTS)
      expect(state.shortcuts).not.toBe(state.defaults)
    })
  })

  describe('loadShortcuts', () => {
    it('loads from serialized JSON', () => {
      const custom = { 'execute-query': { key: 'F5', modifiers: [] } }
      useShortcutStore.getState().loadShortcuts(JSON.stringify(custom))

      const state = useShortcutStore.getState()
      expect(state.shortcuts['execute-query']).toEqual({ key: 'F5', modifiers: [] })
      // Other shortcuts keep defaults
      expect(state.shortcuts['format-query']).toEqual({ key: 'F12', modifiers: [] })
    })

    it('falls back to defaults when serialized is empty', () => {
      useShortcutStore.getState().loadShortcuts('{}')

      const state = useShortcutStore.getState()
      expect(state.shortcuts).toEqual(DEFAULT_SHORTCUTS)
    })

    it('falls back to defaults when serialized is undefined', () => {
      useShortcutStore.getState().loadShortcuts(undefined)

      const state = useShortcutStore.getState()
      expect(state.shortcuts).toEqual(DEFAULT_SHORTCUTS)
    })

    it('handles invalid JSON gracefully', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      useShortcutStore.getState().loadShortcuts('not valid json')

      const state = useShortcutStore.getState()
      expect(state.shortcuts).toEqual(DEFAULT_SHORTCUTS)
      consoleSpy.mockRestore()
    })
  })

  describe('startRecording / cancelRecording', () => {
    it('startRecording sets recordingActionId', () => {
      useShortcutStore.getState().startRecording('execute-query')

      expect(useShortcutStore.getState().recordingActionId).toBe('execute-query')
    })

    it('cancelRecording clears recordingActionId', () => {
      useShortcutStore.getState().startRecording('execute-query')
      useShortcutStore.getState().cancelRecording()

      expect(useShortcutStore.getState().recordingActionId).toBe(null)
    })
  })

  describe('finishRecording', () => {
    it('sets the shortcut when no conflict', () => {
      useShortcutStore.getState().startRecording('execute-query')
      useShortcutStore.getState().finishRecording('execute-query', { key: 'F5', modifiers: [] })

      const state = useShortcutStore.getState()
      expect(state.shortcuts['execute-query']).toEqual({ key: 'F5', modifiers: [] })
      expect(state.recordingActionId).toBe(null)
      expect(state.conflictActionId).toBe(null)
    })

    it('sets conflictActionId when binding conflicts with another action', () => {
      // Try to set 'execute-query' to same binding as 'format-query' (F12)
      useShortcutStore.getState().startRecording('execute-query')
      useShortcutStore.getState().finishRecording('execute-query', { key: 'F12', modifiers: [] })

      const state = useShortcutStore.getState()
      expect(state.conflictActionId).toBe('format-query')
      expect(state.recordingActionId).toBe(null)
      // The shortcut should NOT have been changed
      expect(state.shortcuts['execute-query']).toEqual({ key: 'F9', modifiers: [] })
    })
  })

  describe('resolveConflict', () => {
    it('applies pending binding and resets conflicting action to default', () => {
      // Create a conflict
      useShortcutStore.getState().startRecording('execute-query')
      useShortcutStore.getState().finishRecording('execute-query', { key: 'F12', modifiers: [] })

      // Resolve conflict
      useShortcutStore.getState().resolveConflict()

      const state = useShortcutStore.getState()
      // execute-query should now have F12
      expect(state.shortcuts['execute-query']).toEqual({ key: 'F12', modifiers: [] })
      // format-query should be reset to its default (F12) — but since that conflicts,
      // the actual behavior is that format-query gets its default binding
      expect(state.shortcuts['format-query']).toEqual(DEFAULT_SHORTCUTS['format-query'])
      expect(state.conflictActionId).toBe(null)
    })

    it('does nothing when no conflict is pending', () => {
      const before = { ...useShortcutStore.getState().shortcuts }
      useShortcutStore.getState().resolveConflict()

      expect(useShortcutStore.getState().shortcuts).toEqual(before)
    })
  })

  describe('resetShortcut', () => {
    it('restores default for a specific action', () => {
      // Modify a shortcut
      useShortcutStore.setState({
        shortcuts: { ...DEFAULT_SHORTCUTS, 'execute-query': { key: 'F5', modifiers: [] } },
      })

      useShortcutStore.getState().resetShortcut('execute-query')

      expect(useShortcutStore.getState().shortcuts['execute-query']).toEqual({
        key: 'F9',
        modifiers: [],
      })
    })
  })

  describe('resetAllShortcuts', () => {
    it('restores all defaults', () => {
      useShortcutStore.setState({
        shortcuts: {
          ...DEFAULT_SHORTCUTS,
          'execute-query': { key: 'F5', modifiers: [] },
          'save-file': { key: 'P', modifiers: ['ctrl'] },
        },
      })

      useShortcutStore.getState().resetAllShortcuts()

      expect(useShortcutStore.getState().shortcuts).toEqual(DEFAULT_SHORTCUTS)
    })
  })

  describe('registerAction / unregisterAction / dispatchAction', () => {
    it('registers and dispatches an action callback', () => {
      const callback = vi.fn()
      useShortcutStore.getState().registerAction('execute-query', callback)

      useShortcutStore.getState().dispatchAction('execute-query')
      expect(callback).toHaveBeenCalledTimes(1)
    })

    it('unregisters an action callback', () => {
      const callback = vi.fn()
      useShortcutStore.getState().registerAction('execute-query', callback)
      useShortcutStore.getState().unregisterAction('execute-query')

      useShortcutStore.getState().dispatchAction('execute-query')
      expect(callback).not.toHaveBeenCalled()
    })

    it('does nothing when dispatching an unregistered action', () => {
      // Should not throw
      expect(() => {
        useShortcutStore.getState().dispatchAction('nonexistent-action')
      }).not.toThrow()
    })
  })

  describe('serialization round-trip', () => {
    it('serializes to JSON and deserializes back correctly', () => {
      const custom = {
        ...DEFAULT_SHORTCUTS,
        'execute-query': { key: 'F5', modifiers: ['ctrl'] },
      }
      useShortcutStore.setState({ shortcuts: custom })

      const serialized = useShortcutStore.getState().saveShortcuts()
      expect(typeof serialized).toBe('string')

      // Load into a fresh state
      useShortcutStore.setState({ shortcuts: { ...DEFAULT_SHORTCUTS } })
      useShortcutStore.getState().loadShortcuts(serialized)

      expect(useShortcutStore.getState().shortcuts['execute-query']).toEqual({
        key: 'F5',
        modifiers: ['ctrl'],
      })
    })
  })

  describe('initializeFromBackend', () => {
    it('loads persisted shortcuts from the backend on startup', async () => {
      const custom = { 'execute-query': { key: 'F5', modifiers: [] } }
      mockGetSettingResult = JSON.stringify(custom)

      await useShortcutStore.getState().initializeFromBackend()

      const state = useShortcutStore.getState()
      expect(state.shortcuts['execute-query']).toEqual({ key: 'F5', modifiers: [] })
      // Other shortcuts keep defaults
      expect(state.shortcuts['format-query']).toEqual({ key: 'F12', modifiers: [] })
    })

    it('keeps defaults when backend returns null', async () => {
      mockGetSettingResult = null

      await useShortcutStore.getState().initializeFromBackend()

      const state = useShortcutStore.getState()
      expect(state.shortcuts).toEqual(DEFAULT_SHORTCUTS)
    })

    it('keeps defaults when backend returns empty object', async () => {
      mockGetSettingResult = '{}'

      await useShortcutStore.getState().initializeFromBackend()

      const state = useShortcutStore.getState()
      expect(state.shortcuts).toEqual(DEFAULT_SHORTCUTS)
    })

    it('handles IPC errors gracefully and keeps defaults', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockIPC((cmd) => {
        if (cmd === 'get_setting') throw new Error('IPC failure')
        if (cmd === 'log_frontend') return undefined
        throw new Error(`[vitest] Unmocked Tauri IPC command: ${cmd}`)
      })

      await useShortcutStore.getState().initializeFromBackend()

      const state = useShortcutStore.getState()
      expect(state.shortcuts).toEqual(DEFAULT_SHORTCUTS)
      expect(consoleSpy).toHaveBeenCalledWith(
        '[shortcut-store] Failed to load shortcuts from backend:',
        expect.any(Error)
      )
      consoleSpy.mockRestore()
    })

    it('merges partial persisted shortcuts over defaults', async () => {
      const partial = {
        'execute-query': { key: 'F5', modifiers: ['ctrl'] },
        settings: { key: '.', modifiers: ['ctrl', 'shift'] },
      }
      mockGetSettingResult = JSON.stringify(partial)

      await useShortcutStore.getState().initializeFromBackend()

      const state = useShortcutStore.getState()
      expect(state.shortcuts['execute-query']).toEqual({ key: 'F5', modifiers: ['ctrl'] })
      expect(state.shortcuts['settings']).toEqual({ key: '.', modifiers: ['ctrl', 'shift'] })
      // Non-persisted shortcuts remain at defaults
      expect(state.shortcuts['format-query']).toEqual(DEFAULT_SHORTCUTS['format-query'])
      expect(state.shortcuts['save-file']).toEqual(DEFAULT_SHORTCUTS['save-file'])
    })
  })
})
