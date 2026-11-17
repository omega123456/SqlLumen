import { describe, it, expect } from 'vitest'

import { ipc } from '../ipc-mock'
import {
  getSetting,
  setSetting,
  getAllSettings,
  getThemeSetting,
  setThemeSetting,
} from '../../lib/tauri-commands'

describe('getSetting', () => {
  it('calls invoke with correct command and args', async () => {
    ipc.override('get_setting', () => 'dark')
    const result = await getSetting('theme')
    expect(ipc.calls('get_setting')).toEqual([{ key: 'theme' }])
    expect(result).toBe('dark')
  })

  it('returns null when invoke returns null', async () => {
    ipc.override('get_setting', () => null)
    const result = await getSetting('nonexistent')
    expect(result).toBeNull()
  })
})

describe('setSetting', () => {
  it('calls invoke with correct command and args', async () => {
    await setSetting('theme', 'dark')
    expect(ipc.payloads('set_setting')).toEqual([{ key: 'theme', value: 'dark' }])
  })
})

describe('getAllSettings', () => {
  it('calls invoke with correct command name', async () => {
    ipc.override('get_all_settings', () => ({ theme: 'dark' }))
    const result = await getAllSettings()
    expect(ipc.calls('get_all_settings')).toEqual([{}])
    expect(result).toEqual({ theme: 'dark' })
  })

  it('returns empty object when no settings', async () => {
    ipc.override('get_all_settings', () => ({}))
    const result = await getAllSettings()
    expect(result).toEqual({})
  })
})

describe('getThemeSetting', () => {
  it('reads a valid theme setting and returns null for a missing or unknown value', async () => {
    ipc.override('get_setting', () => 'light')
    expect(await getThemeSetting()).toBe('light')

    ipc.override('get_setting', () => 'dark')
    expect(await getThemeSetting()).toBe('dark')

    ipc.override('get_setting', () => 'system')
    expect(await getThemeSetting()).toBe('system')

    ipc.override('get_setting', () => null)
    expect(await getThemeSetting()).toBeNull()

    ipc.override('get_setting', () => 'invalid_theme')
    expect(await getThemeSetting()).toBeNull()
  })
})

describe('setThemeSetting', () => {
  it('calls setSetting with "theme" key', async () => {
    await setThemeSetting('dark')
    expect(ipc.payloads('set_setting')).toEqual([{ key: 'theme', value: 'dark' }])
  })
})
