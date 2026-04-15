import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
import { renderHook, act } from '@testing-library/react'
import { useSettingsStore, SETTINGS_DEFAULTS, useSettingValue } from '../../stores/settings-store'

// Mock IPC for settings
const mockGetAllSettings = vi.fn<() => Record<string, string>>(() => ({}))
const mockSetSetting = vi.fn<(key: string, value: string) => null>(() => null)

beforeEach(() => {
  // Reset store to initial state
  useSettingsStore.setState({
    settings: {},
    pendingChanges: {},
    isLoading: false,
    isDirty: false,
    activeSection: 'general',
    isDialogOpen: false,
    dialogSection: undefined,
  })

  mockGetAllSettings.mockClear()
  mockSetSetting.mockClear()

  mockIPC((cmd, args) => {
    switch (cmd) {
      case 'get_all_settings':
        return mockGetAllSettings()
      case 'set_setting':
        return mockSetSetting(
          (args as Record<string, string>).key,
          (args as Record<string, string>).value
        )
      case 'log_frontend':
        return undefined
      default:
        return null
    }
  })
})

describe('useSettingsStore', () => {
  describe('loadSettings', () => {
    it('loads settings from backend and uses defaults for missing keys', async () => {
      mockGetAllSettings.mockReturnValue({ theme: 'dark', 'editor.fontSize': '18' })

      await useSettingsStore.getState().loadSettings()

      const state = useSettingsStore.getState()
      expect(state.settings).toEqual({ theme: 'dark', 'editor.fontSize': '18' })
      expect(state.isLoading).toBe(false)
      expect(state.isDirty).toBe(false)

      // getSetting returns loaded value when available
      expect(state.getSetting('theme')).toBe('dark')
      expect(state.getSetting('editor.fontSize')).toBe('18')

      // getSetting returns default for keys not in loaded data
      expect(state.getSetting('editor.wordWrap')).toBe('false')
      expect(state.getSetting('results.pageSize')).toBe('500')
    })

    it('uses defaults when backend returns empty settings', async () => {
      mockGetAllSettings.mockReturnValue({})

      await useSettingsStore.getState().loadSettings()

      const state = useSettingsStore.getState()
      expect(state.settings).toEqual({})
      expect(state.getSetting('theme')).toBe('system')
      expect(state.getSetting('editor.fontFamily')).toBe('JetBrains Mono')
    })

    it('handles load errors gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockGetAllSettings.mockImplementation(() => {
        throw new Error('IPC failure')
      })

      await useSettingsStore.getState().loadSettings()

      const state = useSettingsStore.getState()
      expect(state.isLoading).toBe(false)
      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })
  })

  describe('setPendingChange', () => {
    it('tracks pending changes and updates isDirty', () => {
      useSettingsStore.getState().setPendingChange('theme', 'dark')

      const state = useSettingsStore.getState()
      expect(state.pendingChanges).toEqual({ theme: 'dark' })
      expect(state.isDirty).toBe(true)
    })

    it('overwrites previous pending value for same key', () => {
      const store = useSettingsStore.getState()
      store.setPendingChange('theme', 'dark')
      store.setPendingChange('theme', 'light')

      expect(useSettingsStore.getState().pendingChanges).toEqual({ theme: 'light' })
    })
  })

  describe('getSetting', () => {
    it('returns pending value over loaded value over default', () => {
      useSettingsStore.setState({
        settings: { theme: 'dark' },
        pendingChanges: { theme: 'light' },
      })

      expect(useSettingsStore.getState().getSetting('theme')).toBe('light')
    })

    it('returns loaded value when no pending change', () => {
      useSettingsStore.setState({
        settings: { theme: 'dark' },
        pendingChanges: {},
      })

      expect(useSettingsStore.getState().getSetting('theme')).toBe('dark')
    })

    it('returns default when neither pending nor loaded', () => {
      expect(useSettingsStore.getState().getSetting('theme')).toBe('system')
    })

    it('returns empty string for unknown keys', () => {
      expect(useSettingsStore.getState().getSetting('unknown.key')).toBe('')
    })
  })

  describe('save', () => {
    it('calls setSetting IPC for each pending change and clears pendingChanges', async () => {
      useSettingsStore.setState({
        settings: {},
        pendingChanges: { theme: 'dark', 'editor.fontSize': '18' },
        isDirty: true,
      })

      await useSettingsStore.getState().save()

      expect(mockSetSetting).toHaveBeenCalledTimes(2)
      expect(mockSetSetting).toHaveBeenCalledWith('theme', 'dark')
      expect(mockSetSetting).toHaveBeenCalledWith('editor.fontSize', '18')

      const state = useSettingsStore.getState()
      expect(state.pendingChanges).toEqual({})
      expect(state.isDirty).toBe(false)
      expect(state.settings.theme).toBe('dark')
      expect(state.settings['editor.fontSize']).toBe('18')
    })

    it('handles partial save failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockSetSetting.mockImplementation((key: string) => {
        if (key === 'theme') throw new Error('save failed')
        return null
      })

      useSettingsStore.setState({
        settings: {},
        pendingChanges: { theme: 'dark', 'editor.fontSize': '18' },
        isDirty: true,
      })

      await useSettingsStore.getState().save()

      const state = useSettingsStore.getState()
      // theme should remain in pending (failed), editor.fontSize should be saved
      expect(state.pendingChanges).toEqual({ theme: 'dark' })
      expect(state.isDirty).toBe(true)
      expect(state.settings['editor.fontSize']).toBe('18')
      consoleSpy.mockRestore()
    })
  })

  describe('discard', () => {
    it('reverts pending changes to loaded values', () => {
      useSettingsStore.setState({
        settings: { theme: 'dark' },
        pendingChanges: { theme: 'light', 'editor.fontSize': '20' },
        isDirty: true,
      })

      useSettingsStore.getState().discard()

      const state = useSettingsStore.getState()
      expect(state.pendingChanges).toEqual({})
      expect(state.isDirty).toBe(false)
      // getSetting should now return the loaded value
      expect(state.getSetting('theme')).toBe('dark')
    })
  })

  describe('resetSection', () => {
    it('resets keys for a section to defaults in pendingChanges', () => {
      useSettingsStore.setState({
        settings: { 'editor.fontSize': '18', 'editor.wordWrap': 'true' },
        pendingChanges: {},
        isDirty: false,
      })

      useSettingsStore.getState().resetSection('editor')

      const state = useSettingsStore.getState()
      expect(state.isDirty).toBe(true)

      // All editor keys should be set to defaults in pendingChanges
      expect(state.pendingChanges['editor.fontFamily']).toBe(SETTINGS_DEFAULTS['editor.fontFamily'])
      expect(state.pendingChanges['editor.fontSize']).toBe(SETTINGS_DEFAULTS['editor.fontSize'])
      expect(state.pendingChanges['editor.lineHeight']).toBe(SETTINGS_DEFAULTS['editor.lineHeight'])
      expect(state.pendingChanges['editor.wordWrap']).toBe(SETTINGS_DEFAULTS['editor.wordWrap'])
      expect(state.pendingChanges['editor.minimap']).toBe(SETTINGS_DEFAULTS['editor.minimap'])
      expect(state.pendingChanges['editor.lineNumbers']).toBe(
        SETTINGS_DEFAULTS['editor.lineNumbers']
      )
      expect(state.pendingChanges['editor.autocompleteBackticks']).toBe(
        SETTINGS_DEFAULTS['editor.autocompleteBackticks']
      )
    })

    it('resets general section keys to defaults', () => {
      useSettingsStore.setState({
        settings: { theme: 'dark' },
        pendingChanges: {},
        isDirty: false,
      })

      useSettingsStore.getState().resetSection('general')

      const state = useSettingsStore.getState()
      expect(state.pendingChanges.theme).toBe('system')
      expect(state.pendingChanges['session.restore']).toBe('true')
    })
  })

  describe('setActiveSection', () => {
    it('updates the active section', () => {
      useSettingsStore.getState().setActiveSection('editor')
      expect(useSettingsStore.getState().activeSection).toBe('editor')

      useSettingsStore.getState().setActiveSection('shortcuts')
      expect(useSettingsStore.getState().activeSection).toBe('shortcuts')
    })
  })

  describe('useSettingValue', () => {
    it('returns default when neither pending nor loaded', () => {
      const { result } = renderHook(() => useSettingValue('editor.wordWrap'))
      expect(result.current).toBe('false')
    })

    it('returns loaded value over default', () => {
      useSettingsStore.setState({ settings: { 'editor.wordWrap': 'true' } })
      const { result } = renderHook(() => useSettingValue('editor.wordWrap'))
      expect(result.current).toBe('true')
    })

    it('returns pending value over loaded value', () => {
      useSettingsStore.setState({
        settings: { 'editor.wordWrap': 'true' },
        pendingChanges: { 'editor.wordWrap': 'false' },
      })
      const { result } = renderHook(() => useSettingValue('editor.wordWrap'))
      expect(result.current).toBe('false')
    })

    it('re-renders when pendingChanges updates (toggle on then off)', () => {
      // This is the regression test for the checkbox toggle-off bug.
      // The old pattern `useSettingsStore((s) => s.getSetting)` returned
      // a stable function reference, so Zustand never triggered re-renders
      // after the first pendingChanges update.
      const { result } = renderHook(() => useSettingValue('editor.wordWrap'))
      expect(result.current).toBe('false') // default

      // Simulate toggle ON
      act(() => {
        useSettingsStore.getState().setPendingChange('editor.wordWrap', 'true')
      })
      expect(result.current).toBe('true')

      // Simulate toggle OFF — this was the broken path
      act(() => {
        useSettingsStore.getState().setPendingChange('editor.wordWrap', 'false')
      })
      expect(result.current).toBe('false')
    })

    it('returns empty string for unknown keys', () => {
      const { result } = renderHook(() => useSettingValue('nonexistent.key'))
      expect(result.current).toBe('')
    })
  })

  describe('dialog state', () => {
    it('isDialogOpen defaults to false', () => {
      expect(useSettingsStore.getState().isDialogOpen).toBe(false)
    })

    it('openDialog() sets isDialogOpen to true', () => {
      useSettingsStore.getState().openDialog()
      expect(useSettingsStore.getState().isDialogOpen).toBe(true)
    })

    it('openDialog("ai") sets isDialogOpen to true and dialogSection to "ai"', () => {
      useSettingsStore.getState().openDialog('ai')
      expect(useSettingsStore.getState().isDialogOpen).toBe(true)
      expect(useSettingsStore.getState().dialogSection).toBe('ai')
    })

    it('closeDialog() sets isDialogOpen to false', () => {
      useSettingsStore.getState().openDialog()
      expect(useSettingsStore.getState().isDialogOpen).toBe(true)

      useSettingsStore.getState().closeDialog()
      expect(useSettingsStore.getState().isDialogOpen).toBe(false)
    })
  })
})
