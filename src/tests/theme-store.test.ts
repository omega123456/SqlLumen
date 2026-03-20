import { describe, it, expect, beforeEach } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
import { useThemeStore } from '../stores/theme-store'
import { setupMatchMedia } from './helpers/mock-match-media'

beforeEach(() => {
  // Reset store state between tests
  useThemeStore.setState({ theme: 'system', resolvedTheme: 'light' })
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
    const setCalls: Array<{ key: string; value: string }> = []
    mockIPC((cmd, args) => {
      if (cmd === 'set_setting') {
        const { key, value } = args as { key: string; value: string }
        setCalls.push({ key, value })
      }
      return null
    })

    await useThemeStore.getState().setTheme('dark')
    // Allow microtasks to flush
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(setCalls).toContainEqual({ key: 'theme', value: 'dark' })
  })

  it('setTheme still works when IPC fails (silent error)', async () => {
    mockIPC((cmd) => {
      if (cmd === 'set_setting') {
        throw new Error('IPC error')
      }
      return null
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
    mockIPC((cmd) => {
      if (cmd === 'get_setting') return null // no saved theme
      return null
    })

    await useThemeStore.getState().initialize()
    expect(useThemeStore.getState().resolvedTheme).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('initialize applies saved theme from SQLite', async () => {
    setupMatchMedia(false) // system prefers light
    mockIPC((cmd) => {
      if (cmd === 'get_setting') return 'dark' // saved theme is dark
      return null
    })

    await useThemeStore.getState().initialize()
    expect(useThemeStore.getState().theme).toBe('dark')
    expect(useThemeStore.getState().resolvedTheme).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('initialize falls back to system preference when IPC fails', async () => {
    setupMatchMedia(true) // system prefers dark
    mockIPC((cmd) => {
      if (cmd === 'get_setting') throw new Error('IPC error')
      return null
    })

    await expect(useThemeStore.getState().initialize()).resolves.toBeUndefined()
    // Should fall back to system dark
    expect(useThemeStore.getState().resolvedTheme).toBe('dark')
  })

  it('initialize sets theme to "system" when falling back to system preference', async () => {
    mockIPC((cmd) => {
      if (cmd === 'get_setting') return null
      return null
    })

    await useThemeStore.getState().initialize()
    expect(useThemeStore.getState().theme).toBe('system')
  })
})
