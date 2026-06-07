import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipc } from '../ipc-mock'
import {
  COMMAND_PALETTE_RECENTS_MAX_PER_PROFILE,
  useCommandPaletteRecentsStore,
} from '../../stores/command-palette-recents-store'
import { SETTINGS_DEFAULTS } from '../../stores/settings-store'

const mockGetSetting = vi.fn<(key: string) => string | null>(() => null)
const mockSetSetting = vi.fn<(key: string, value: string) => Promise<void>>(() => Promise.resolve())
const mockLogFrontend = vi.fn<(level: string, message: string) => void>(() => undefined)

describe('useCommandPaletteRecentsStore', () => {
  beforeEach(() => {
    useCommandPaletteRecentsStore.setState({
      recentsByProfile: {},
      isInitialized: false,
    })

    mockGetSetting.mockReset()
    mockSetSetting.mockReset()
    mockLogFrontend.mockReset()

    mockGetSetting.mockReturnValue(null)
    mockSetSetting.mockResolvedValue(undefined)

    ipc.override('get_setting', (args) =>
      mockGetSetting(String((args as Record<string, unknown>)?.key ?? ''))
    )
    ipc.override('set_setting', (args) =>
      mockSetSetting(
        String((args as Record<string, unknown>)?.key ?? ''),
        String((args as Record<string, unknown>)?.value ?? '')
      )
    )
    ipc.override('log_frontend', (args) => {
      const payload = args as Record<string, unknown>
      mockLogFrontend(String(payload.level), String(payload.message))
      return undefined
    })
  })

  it('adds a default for commandPalette.recents without exposing it via settings sections', () => {
    expect(SETTINGS_DEFAULTS['commandPalette.recents']).toBe('{}')
  })

  it('loads persisted recents from settings', async () => {
    mockGetSetting.mockReturnValue(
      JSON.stringify({
        'profile-1': [
          {
            database: 'analytics',
            objectType: 'table',
            name: 'users',
            lastUsedAt: '2026-06-06T12:00:00.000Z',
          },
        ],
      })
    )

    await useCommandPaletteRecentsStore.getState().initializeFromBackend()

    expect(useCommandPaletteRecentsStore.getState().isInitialized).toBe(true)
    expect(useCommandPaletteRecentsStore.getState().getRecents('profile-1')).toEqual([
      {
        database: 'analytics',
        objectType: 'table',
        name: 'users',
        lastUsedAt: '2026-06-06T12:00:00.000Z',
      },
    ])
  })

  it('tolerates malformed JSON during load', async () => {
    mockGetSetting.mockReturnValue('{not-json')

    await useCommandPaletteRecentsStore.getState().initializeFromBackend()

    expect(useCommandPaletteRecentsStore.getState().isInitialized).toBe(true)
    expect(useCommandPaletteRecentsStore.getState().getRecents('profile-1')).toEqual([])
    expect(mockLogFrontend).toHaveBeenCalledWith(
      'error',
      expect.stringContaining('[command-palette-recents-store] Failed to parse recents:')
    )
  })

  it('orders newest first and deduplicates matching selections', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-06T12:00:00.000Z'))

    useCommandPaletteRecentsStore.getState().recordSelection('profile-1', {
      database: 'analytics',
      objectType: 'table',
      name: 'users',
    })

    vi.setSystemTime(new Date('2026-06-06T12:01:00.000Z'))

    useCommandPaletteRecentsStore.getState().recordSelection('profile-1', {
      database: 'analytics',
      objectType: 'view',
      name: 'active_users',
    })

    vi.setSystemTime(new Date('2026-06-06T12:02:00.000Z'))

    useCommandPaletteRecentsStore.getState().recordSelection('profile-1', {
      database: 'analytics',
      objectType: 'table',
      name: 'users',
    })

    expect(useCommandPaletteRecentsStore.getState().getRecents('profile-1')).toEqual([
      {
        database: 'analytics',
        objectType: 'table',
        name: 'users',
        lastUsedAt: '2026-06-06T12:02:00.000Z',
      },
      {
        database: 'analytics',
        objectType: 'view',
        name: 'active_users',
        lastUsedAt: '2026-06-06T12:01:00.000Z',
      },
    ])

    vi.useRealTimers()
  })

  it('caps recents per profile and keeps profiles isolated', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-06T12:00:00.000Z'))

    for (let index = 0; index < COMMAND_PALETTE_RECENTS_MAX_PER_PROFILE + 2; index += 1) {
      vi.setSystemTime(new Date(`2026-06-06T12:${String(index).padStart(2, '0')}:00.000Z`))
      useCommandPaletteRecentsStore.getState().recordSelection('profile-1', {
        database: 'analytics',
        objectType: 'table',
        name: `table_${index}`,
      })
    }

    useCommandPaletteRecentsStore.getState().recordSelection('profile-2', {
      database: 'sales',
      objectType: 'procedure',
      name: 'refresh_rollup',
    })

    const profileOneRecents = useCommandPaletteRecentsStore.getState().getRecents('profile-1')
    expect(profileOneRecents).toHaveLength(COMMAND_PALETTE_RECENTS_MAX_PER_PROFILE)
    expect(profileOneRecents[0]?.name).toBe(
      `table_${COMMAND_PALETTE_RECENTS_MAX_PER_PROFILE + 1}`
    )
    expect(profileOneRecents[profileOneRecents.length - 1]?.name).toBe('table_2')
    expect(useCommandPaletteRecentsStore.getState().getRecents('profile-2')).toEqual([
      {
        database: 'sales',
        objectType: 'procedure',
        name: 'refresh_rollup',
        lastUsedAt: `2026-06-06T12:${String(COMMAND_PALETTE_RECENTS_MAX_PER_PROFILE + 1).padStart(2, '0')}:00.000Z`,
      },
    ])

    vi.useRealTimers()
  })

  it('persists updates fire-and-forget', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-06T12:00:00.000Z'))

    useCommandPaletteRecentsStore.getState().recordSelection('profile-1', {
      database: 'analytics',
      objectType: 'trigger',
      name: 'users_after_insert',
    })

    expect(mockSetSetting).toHaveBeenCalledWith(
      'commandPalette.recents',
      JSON.stringify({
        'profile-1': [
          {
            database: 'analytics',
            objectType: 'trigger',
            name: 'users_after_insert',
            lastUsedAt: '2026-06-06T12:00:00.000Z',
          },
        ],
      })
    )

    vi.useRealTimers()
  })

  it('logs persistence errors without rolling back in-memory state', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-06T12:00:00.000Z'))
    mockSetSetting.mockRejectedValueOnce(new Error('persist failed'))

    useCommandPaletteRecentsStore.getState().recordSelection('profile-1', {
      database: 'analytics',
      objectType: 'function',
      name: 'normalize_name',
    })

    await vi.runAllTimersAsync()

    expect(useCommandPaletteRecentsStore.getState().getRecents('profile-1')).toEqual([
      {
        database: 'analytics',
        objectType: 'function',
        name: 'normalize_name',
        lastUsedAt: '2026-06-06T12:00:00.000Z',
      },
    ])
    expect(mockLogFrontend).toHaveBeenCalledWith(
      'error',
      expect.stringContaining('[command-palette-recents-store] Failed to persist recents:')
    )

    vi.useRealTimers()
  })
})
