import { describe, it, expect, beforeEach } from 'vitest'
import { ipc } from './ipc-mock'
import { useThemeStore } from '../stores/theme-store'
import { setupMatchMedia } from './helpers/mock-match-media'

beforeEach(() => {
  // Reset store state between tests
  useThemeStore.setState({ theme: 'system', resolvedTheme: 'light', _previewSnapshot: null })
  document.documentElement.removeAttribute('data-theme')
  setupMatchMedia(false) // default: system prefers light
})

describe('useThemeStore — initial state', () => {
  it('has correct initial state', () => {
    const state = useThemeStore.getState()
    expect(state.theme).toBe('system')
    expect(state.resolvedTheme).toBe('light')
  })
})

describe('useThemeStore — setTheme', () => {
  it('setTheme to "light" sets resolvedTheme to "light"', async () => {
    await useThemeStore.getState().setTheme('light')
    expect(useThemeStore.getState().theme).toBe('light')
    expect(useThemeStore.getState().resolvedTheme).toBe('light')
  })

  it('setTheme to "dark" sets resolvedTheme to "dark"', async () => {
    await useThemeStore.getState().setTheme('dark')
    expect(useThemeStore.getState().theme).toBe('dark')
    expect(useThemeStore.getState().resolvedTheme).toBe('dark')
  })

  it('setTheme applies data-theme attribute to documentElement', async () => {
    await useThemeStore.getState().setTheme('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')

    await useThemeStore.getState().setTheme('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('setTheme to "system" resolves based on matchMedia', async () => {
    setupMatchMedia(false)
    await useThemeStore.getState().setTheme('system')
    expect(useThemeStore.getState().resolvedTheme).toBe('light')

    setupMatchMedia(true)
    await useThemeStore.getState().setTheme('system')
    expect(useThemeStore.getState().resolvedTheme).toBe('dark')
  })

  it('setTheme calls set_setting IPC with correct args', async () => {
    await useThemeStore.getState().setTheme('dark')
    await Promise.resolve()
    expect(ipc.calls('set_setting')).toContainEqual({ key: 'theme', value: 'dark' })
  })

  it('setTheme still works when IPC fails (silent error)', async () => {
    ipc.override('set_setting', () => {
      throw new Error('IPC error')
    })

    // Should not throw
    await expect(useThemeStore.getState().setTheme('dark')).resolves.toBeUndefined()
    // Theme should still be applied
    expect(useThemeStore.getState().resolvedTheme).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })
})

describe('useThemeStore — initialize', () => {
  it('initialize reads system preference when no saved theme', async () => {
    setupMatchMedia(true) // system prefers dark
    ipc.override('get_setting', () => null)

    await useThemeStore.getState().initialize()
    expect(useThemeStore.getState().resolvedTheme).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('initialize applies saved theme from SQLite', async () => {
    setupMatchMedia(false) // system prefers light
    ipc.override('get_setting', () => 'dark')

    await useThemeStore.getState().initialize()
    expect(useThemeStore.getState().theme).toBe('dark')
    expect(useThemeStore.getState().resolvedTheme).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('initialize falls back to system preference when IPC fails', async () => {
    setupMatchMedia(true) // system prefers dark
    ipc.override('get_setting', () => {
      throw new Error('IPC error')
    })

    await expect(useThemeStore.getState().initialize()).resolves.toBeUndefined()
    // Should fall back to system dark
    expect(useThemeStore.getState().resolvedTheme).toBe('dark')
  })

  it('initialize sets theme to "system" when falling back to system preference', async () => {
    ipc.override('get_setting', () => null)

    await useThemeStore.getState().initialize()
    expect(useThemeStore.getState().theme).toBe('system')
  })
})

describe('useThemeStore — previewTheme', () => {
  it('applies the previewed theme to the DOM without persisting', () => {
    // Start with light theme
    useThemeStore.setState({ theme: 'light', resolvedTheme: 'light', _previewSnapshot: null })
    document.documentElement.setAttribute('data-theme', 'light')

    useThemeStore.getState().previewTheme('dark')

    // DOM should reflect the preview
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(useThemeStore.getState().resolvedTheme).toBe('dark')
    // The original theme is captured in the snapshot
    expect(useThemeStore.getState()._previewSnapshot).toBe('light')
    // But the store's `theme` is NOT changed (preview doesn't mutate theme)
    expect(useThemeStore.getState().theme).toBe('light')
  })

  it('captures snapshot only on the first preview call', () => {
    useThemeStore.setState({ theme: 'light', resolvedTheme: 'light', _previewSnapshot: null })

    // First preview call — captures 'light' as the snapshot
    useThemeStore.getState().previewTheme('dark')
    expect(useThemeStore.getState()._previewSnapshot).toBe('light')

    // Second preview call — snapshot stays 'light' (not 'dark')
    useThemeStore.getState().previewTheme('system')
    expect(useThemeStore.getState()._previewSnapshot).toBe('light')
  })

  it('resolves "system" theme during preview', () => {
    setupMatchMedia(true) // system prefers dark
    useThemeStore.setState({ theme: 'light', resolvedTheme: 'light', _previewSnapshot: null })

    useThemeStore.getState().previewTheme('system')

    expect(useThemeStore.getState().resolvedTheme).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })
})

describe('useThemeStore — revertPreview', () => {
  it('reverts to the snapshot theme and clears the snapshot', () => {
    // Simulate: user was on 'light', then previewed 'dark'
    useThemeStore.setState({ theme: 'light', resolvedTheme: 'dark', _previewSnapshot: 'light' })
    document.documentElement.setAttribute('data-theme', 'dark')

    useThemeStore.getState().revertPreview()

    expect(useThemeStore.getState().theme).toBe('light')
    expect(useThemeStore.getState().resolvedTheme).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(useThemeStore.getState()._previewSnapshot).toBeNull()
  })

  it('does nothing when there is no snapshot', () => {
    useThemeStore.setState({ theme: 'dark', resolvedTheme: 'dark', _previewSnapshot: null })
    document.documentElement.setAttribute('data-theme', 'dark')

    useThemeStore.getState().revertPreview()

    // State and DOM remain unchanged
    expect(useThemeStore.getState().theme).toBe('dark')
    expect(useThemeStore.getState().resolvedTheme).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(useThemeStore.getState()._previewSnapshot).toBeNull()
  })
})

describe('useThemeStore — getSystemTheme fallback', () => {
  it('returns "light" when matchMedia is unavailable', async () => {
    // Remove matchMedia entirely to trigger line 11 fallback
    const original = window.matchMedia
    Object.defineProperty(window, 'matchMedia', { writable: true, value: undefined })

    try {
      await useThemeStore.getState().setTheme('system')
      // Without matchMedia, system theme resolves to 'light'
      expect(useThemeStore.getState().resolvedTheme).toBe('light')
    } finally {
      // Restore matchMedia so other tests aren't affected
      Object.defineProperty(window, 'matchMedia', { writable: true, value: original })
    }
  })
})
