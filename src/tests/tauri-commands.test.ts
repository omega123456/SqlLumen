import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getSetting,
  setSetting,
  getAllSettings,
  getThemeSetting,
  setThemeSetting,
} from '../lib/tauri-commands'

// Mock the @tauri-apps/api/core module
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'
const mockInvoke = vi.mocked(invoke)

beforeEach(() => {
  mockInvoke.mockReset()
})

describe('getSetting', () => {
  it('calls invoke with correct command and args', async () => {
    mockInvoke.mockResolvedValue('dark')
    const result = await getSetting('theme')
    expect(mockInvoke).toHaveBeenCalledWith('get_setting', { key: 'theme' })
    expect(result).toBe('dark')
  })

  it('returns null when invoke returns null', async () => {
    mockInvoke.mockResolvedValue(null)
    const result = await getSetting('nonexistent')
    expect(result).toBeNull()
  })
})

describe('setSetting', () => {
  it('calls invoke with correct command and args', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await setSetting('theme', 'dark')
    expect(mockInvoke).toHaveBeenCalledWith('set_setting', { key: 'theme', value: 'dark' })
  })
})

describe('getAllSettings', () => {
  it('calls invoke with correct command name', async () => {
    mockInvoke.mockResolvedValue({ theme: 'dark' })
    const result = await getAllSettings()
    expect(mockInvoke).toHaveBeenCalledWith('get_all_settings')
    expect(result).toEqual({ theme: 'dark' })
  })

  it('returns empty object when no settings', async () => {
    mockInvoke.mockResolvedValue({})
    const result = await getAllSettings()
    expect(result).toEqual({})
  })
})

describe('getThemeSetting', () => {
  it('returns "light" when setting is "light"', async () => {
    mockInvoke.mockResolvedValue('light')
    expect(await getThemeSetting()).toBe('light')
  })

  it('returns "dark" when setting is "dark"', async () => {
    mockInvoke.mockResolvedValue('dark')
    expect(await getThemeSetting()).toBe('dark')
  })

  it('returns "system" when setting is "system"', async () => {
    mockInvoke.mockResolvedValue('system')
    expect(await getThemeSetting()).toBe('system')
  })

  it('returns null when no setting stored', async () => {
    mockInvoke.mockResolvedValue(null)
    expect(await getThemeSetting()).toBeNull()
  })

  it('returns null for invalid/unknown values', async () => {
    mockInvoke.mockResolvedValue('invalid_theme')
    expect(await getThemeSetting()).toBeNull()
  })
})

describe('setThemeSetting', () => {
  it('calls setSetting with "theme" key', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await setThemeSetting('dark')
    expect(mockInvoke).toHaveBeenCalledWith('set_setting', { key: 'theme', value: 'dark' })
  })
})
