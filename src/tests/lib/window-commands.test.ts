import { afterEach, describe, expect, it } from 'vitest'
import { ipc } from '../ipc-mock'
import {
  applyWindowBackdrop,
  getWindowBackdrop,
  setWindowTheme,
  syncNativeTheme,
} from '../../lib/window-commands'

afterEach(() => {
  document.documentElement.classList.remove('mica')
})

function logMessages(): string[] {
  return ipc.calls('log_frontend').map((call) => (call as { message: string }).message)
}

describe('window commands', () => {
  it('invokes set_window_theme and get_window_backdrop', async () => {
    await setWindowTheme('dark')
    expect(ipc.calls('set_window_theme')).toEqual([{ theme: 'dark' }])
    await expect(getWindowBackdrop()).resolves.toBe('solid')
  })
})

describe('syncNativeTheme', () => {
  it('passes light and dark through and lets the OS decide for system', async () => {
    await syncNativeTheme('light')
    await syncNativeTheme('dark')
    await syncNativeTheme('system')
    expect(ipc.calls('set_window_theme')).toEqual([
      { theme: 'light' },
      { theme: 'dark' },
      { theme: null },
    ])
  })

  it('logs instead of throwing when the native call fails', async () => {
    ipc.override('set_window_theme', () => {
      throw new Error('no window')
    })
    await expect(syncNativeTheme('dark')).resolves.toBeUndefined()
    expect(logMessages().some((m) => m.includes('set_window_theme failed (dark)'))).toBe(true)
  })
})

describe('applyWindowBackdrop', () => {
  it('adds the mica class when the window got Mica', async () => {
    ipc.override('get_window_backdrop', () => 'mica')
    await applyWindowBackdrop()
    expect(document.documentElement).toHaveClass('mica')
  })

  it('removes the mica class for the solid backdrop', async () => {
    document.documentElement.classList.add('mica')
    await applyWindowBackdrop()
    expect(document.documentElement).not.toHaveClass('mica')
  })

  it('logs and keeps the solid look when the backdrop cannot be read', async () => {
    ipc.override('get_window_backdrop', () => {
      throw new Error('no window')
    })
    await expect(applyWindowBackdrop()).resolves.toBeUndefined()
    expect(document.documentElement).not.toHaveClass('mica')
    expect(logMessages().some((m) => m.includes('get_window_backdrop failed'))).toBe(true)
  })
})
