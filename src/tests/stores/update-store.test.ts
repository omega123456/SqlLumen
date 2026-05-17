import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'

const { mockCheck, mockRelaunch, mockPlatform, mockHasTauriApis, mockLogFrontend } = vi.hoisted(
  () => ({
    mockCheck: vi.fn(),
    mockRelaunch: vi.fn(),
    mockPlatform: vi.fn(),
    mockHasTauriApis: vi.fn(),
    mockLogFrontend: vi.fn(),
  })
)

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: mockCheck,
}))

vi.mock('@tauri-apps/plugin-os', () => ({
  platform: mockPlatform,
}))

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: mockRelaunch,
}))

vi.mock('../../lib/tauri-env', () => ({
  hasTauriApis: mockHasTauriApis,
}))

vi.mock('../../lib/app-log-commands', () => ({
  logFrontend: mockLogFrontend,
}))

import { useSettingsStore } from '../../stores/settings-store'
import { useUpdateStore } from '../../stores/update-store'

type MockProgressEvent =
  | { event: 'Started'; data?: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' }

interface MockUpdate {
  version?: string
  downloadAndInstall: (onEvent?: (event: MockProgressEvent) => void) => Promise<void>
}

function makeAvailableUpdate(version = '2.0.0', progressChunks: number[] = [100]): MockUpdate {
  return {
    version,
    downloadAndInstall: vi.fn(async (onEvent?: (event: MockProgressEvent) => void) => {
      onEvent?.({ event: 'Started', data: { contentLength: 100 } })
      for (const chunkLength of progressChunks) {
        onEvent?.({ event: 'Progress', data: { chunkLength } })
      }
      onEvent?.({ event: 'Finished' })
    }),
  }
}

function setReadyToFinishState(version: string, platform: 'macos' | 'windows' | 'linux'): void {
  const isLinux = platform === 'linux'
  useUpdateStore.setState({
    status: 'ready-to-finish',
    currentPlatform: platform,
    readyToFinishAction: isLinux ? 'manual-quit' : 'relaunch',
    readyToFinishCta: isLinux ? 'Got it' : 'Restart App',
    readyToFinishMessage: isLinux
      ? `Quit and reopen SqlLumen to finish installing version ${version}.`
      : `Restart SqlLumen to finish installing version ${version}.`,
    availableVersion: version,
    downloadProgress: 100,
    errorMessage: null,
    updateObject: null,
  })
}

function resetStores(): void {
  useSettingsStore.setState({
    settings: {},
    pendingChanges: {},
    isLoading: false,
    isDirty: false,
    activeSection: 'general',
    isDialogOpen: false,
    dialogSection: undefined,
  })

  useUpdateStore.getState().stopPeriodicCheck()
  useUpdateStore.setState({
    status: 'idle',
    currentPlatform: 'unknown',
    readyToFinishAction: 'relaunch',
    readyToFinishCta: 'Restart App',
    readyToFinishMessage: 'Restart SqlLumen to finish installing version the latest version.',
    availableVersion: null,
    downloadProgress: 0,
    errorMessage: null,
    updateObject: null,
  })
}

describe('useUpdateStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetStores()
    mockCheck.mockReset()
    mockRelaunch.mockReset()
    mockPlatform.mockReset()
    mockHasTauriApis.mockReset()
    mockLogFrontend.mockReset()
    mockHasTauriApis.mockReturnValue(true)
    mockPlatform.mockResolvedValue('macos')
  })

  afterEach(() => {
    useUpdateStore.getState().stopPeriodicCheck()
    vi.useRealTimers()
  })

  it('manual check sets available state when update exists', async () => {
    const update = makeAvailableUpdate()
    mockCheck.mockResolvedValue(update)

    await useUpdateStore.getState().checkForUpdate(true)

    expect(mockCheck).toHaveBeenCalledTimes(1)
    expect(useUpdateStore.getState()).toMatchObject({
      status: 'available',
      availableVersion: '2.0.0',
      errorMessage: null,
      updateObject: update,
    })
  })

  it('manual check errors set error state and message', async () => {
    mockCheck.mockRejectedValue(new Error('manual failure'))

    await useUpdateStore.getState().checkForUpdate(true)

    expect(mockLogFrontend).toHaveBeenCalledWith(
      'error',
      '[update-store] Manual update check failed: manual failure'
    )
    expect(useUpdateStore.getState()).toMatchObject({
      status: 'error',
      errorMessage: 'manual failure',
    })
  })

  it('manual check with no update shows up-to-date then returns to idle after 5 seconds', async () => {
    mockCheck.mockResolvedValue(null)

    await useUpdateStore.getState().checkForUpdate(true)
    expect(useUpdateStore.getState().status).toBe('up-to-date')

    await vi.advanceTimersByTimeAsync(4_999)
    expect(useUpdateStore.getState().status).toBe('up-to-date')

    await vi.advanceTimersByTimeAsync(1)
    expect(useUpdateStore.getState().status).toBe('idle')
  })

  it('automatic check with no update returns to idle directly', async () => {
    mockCheck.mockResolvedValue(null)

    await useUpdateStore.getState().checkForUpdate(false)

    expect(useUpdateStore.getState()).toMatchObject({
      status: 'idle',
      availableVersion: null,
      errorMessage: null,
    })
  })

  it('check from error state resets to checking and proceeds', async () => {
    useUpdateStore.setState({ status: 'error', errorMessage: 'previous failure' })
    mockCheck.mockResolvedValue(null)

    const pending = useUpdateStore.getState().checkForUpdate(true)
    expect(useUpdateStore.getState()).toMatchObject({ status: 'checking', errorMessage: null })

    await pending
    expect(useUpdateStore.getState().status).toBe('up-to-date')
  })

  it('ignores overlapping checks while already checking', async () => {
    let resolveCheck: ((value: MockUpdate | null) => void) | undefined
    mockCheck.mockImplementation(
      () =>
        new Promise<MockUpdate | null>((resolve) => {
          resolveCheck = resolve
        })
    )

    const firstCheck = useUpdateStore.getState().checkForUpdate(true)
    const secondCheck = useUpdateStore.getState().checkForUpdate(true)

    expect(mockCheck).toHaveBeenCalledTimes(1)

    resolveCheck?.(null)
    await firstCheck
    await secondCheck
  })

  it('ignores checks while installing', async () => {
    useUpdateStore.setState({ status: 'installing' })

    await useUpdateStore.getState().checkForUpdate(true)

    expect(mockCheck).not.toHaveBeenCalled()
  })

  it('cancels pending up-to-date timeout when a new check starts', async () => {
    mockCheck.mockResolvedValue(null)

    await useUpdateStore.getState().checkForUpdate(true)
    expect(useUpdateStore.getState().status).toBe('up-to-date')

    const update = makeAvailableUpdate('3.1.0')
    mockCheck.mockResolvedValueOnce(update)

    await useUpdateStore.getState().checkForUpdate(true)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(useUpdateStore.getState().status).toBe('available')
    expect(useUpdateStore.getState().availableVersion).toBe('3.1.0')
  })

  it('downloadAndInstall tracks progress and relaunches after finish on macOS', async () => {
    const update = makeAvailableUpdate('4.0.0', [25, 25, 50])
    mockCheck.mockResolvedValue(update)
    await useUpdateStore.getState().checkForUpdate(true)

    await useUpdateStore.getState().downloadAndInstall()

    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1)
    expect(useUpdateStore.getState()).toMatchObject({
      status: 'installing',
      downloadProgress: 100,
      errorMessage: null,
      updateObject: null,
    })
    expect(mockRelaunch).toHaveBeenCalledTimes(1)
  })

  it.each([
    {
      platform: 'windows',
      version: '4.0.0',
      readyToFinishAction: 'relaunch',
      readyToFinishCta: 'Restart App',
      readyToFinishMessage: 'Restart SqlLumen to finish installing version 4.0.0.',
    },
    {
      platform: 'linux',
      version: '4.1.0',
      readyToFinishAction: 'manual-quit',
      readyToFinishCta: 'Got it',
      readyToFinishMessage: 'Quit and reopen SqlLumen to finish installing version 4.1.0.',
    },
  ] as const)(
    'downloadAndInstall moves to ready-to-finish after finish on $platform',
    async ({ platform, version, readyToFinishAction, readyToFinishCta, readyToFinishMessage }) => {
      mockPlatform.mockResolvedValue(platform)

      const update = makeAvailableUpdate(version)
      mockCheck.mockResolvedValue(update)
      await useUpdateStore.getState().checkForUpdate(true)

      await useUpdateStore.getState().downloadAndInstall()

      expect(useUpdateStore.getState()).toMatchObject({
        status: 'ready-to-finish',
        currentPlatform: platform,
        readyToFinishAction,
        readyToFinishCta,
        readyToFinishMessage,
        availableVersion: version,
        downloadProgress: 100,
        errorMessage: null,
        updateObject: null,
      })
      expect(mockRelaunch).not.toHaveBeenCalled()
    }
  )

  it('restartApp relaunches on Windows from ready-to-finish', async () => {
    mockPlatform.mockResolvedValue('windows')
    setReadyToFinishState('4.0.0', 'windows')

    await useUpdateStore.getState().restartApp()

    expect(mockRelaunch).toHaveBeenCalledTimes(1)
  })

  it('restartApp does not relaunch on Linux from ready-to-finish', async () => {
    mockPlatform.mockResolvedValue('linux')
    setReadyToFinishState('4.1.0', 'linux')

    await useUpdateStore.getState().restartApp()

    expect(mockRelaunch).not.toHaveBeenCalled()
    expect(useUpdateStore.getState()).toMatchObject({
      status: 'ready-to-finish',
      availableVersion: '4.1.0',
      downloadProgress: 100,
    })
  })

  it('restartApp keeps ready-to-finish state when relaunch fails', async () => {
    mockPlatform.mockResolvedValue('windows')
    mockRelaunch.mockRejectedValue(new Error('restart failed'))
    setReadyToFinishState('4.0.0', 'windows')

    await useUpdateStore.getState().restartApp()

    expect(mockLogFrontend).toHaveBeenCalledWith(
      'error',
      '[update-store] Restart failed: restart failed'
    )
    expect(useUpdateStore.getState()).toMatchObject({
      status: 'ready-to-finish',
      availableVersion: '4.0.0',
      downloadProgress: 100,
      errorMessage: 'restart failed',
    })
  })

  it('downloadAndInstall stores error state on failure', async () => {
    const downloadAndInstall = vi.fn(async () => {
      throw new Error('download failed')
    })

    mockCheck.mockResolvedValue({ version: '4.0.0', downloadAndInstall })
    await useUpdateStore.getState().checkForUpdate(true)

    await useUpdateStore.getState().downloadAndInstall()

    expect(useUpdateStore.getState()).toMatchObject({
      status: 'error',
      errorMessage: 'download failed',
    })
    expect(mockLogFrontend).toHaveBeenCalledWith(
      'error',
      '[update-store] Install failed: download failed'
    )
    expect(mockRelaunch).not.toHaveBeenCalled()
  })

  it('allows re-checks when update is already available to catch newer versions', async () => {
    useUpdateStore.setState({ status: 'available', availableVersion: '1.2.3' })
    mockCheck.mockResolvedValueOnce({ version: '1.2.4' })

    await useUpdateStore.getState().checkForUpdate(false)

    expect(mockCheck).toHaveBeenCalled()
    expect(useUpdateStore.getState().availableVersion).toBe('1.2.4')
  })

  it('does not create interval if periodic check was stopped during initial await', async () => {
    useSettingsStore.setState({ settings: { 'updates.checkInterval': '1h' } })

    let resolveCheck: (() => void) | undefined
    mockCheck.mockImplementation(
      () =>
        new Promise<null>((resolve) => {
          resolveCheck = () => resolve(null)
        })
    )

    const startPromise = useUpdateStore.getState().startPeriodicCheck()
    useUpdateStore.getState().stopPeriodicCheck()
    resolveCheck?.()
    await startPromise

    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(mockCheck).toHaveBeenCalledTimes(1)
  })

  it('startPeriodicCheck with 1h interval runs immediately and again after interval', async () => {
    useSettingsStore.setState({ settings: { 'updates.checkInterval': '1h' } })
    mockCheck.mockResolvedValue(null)

    await useUpdateStore.getState().startPeriodicCheck()

    expect(mockCheck).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(mockCheck).toHaveBeenCalledTimes(2)
  })

  it('startPeriodicCheck with off does not schedule or run immediate checks', async () => {
    useSettingsStore.setState({ settings: { 'updates.checkInterval': 'off' } })

    await useUpdateStore.getState().startPeriodicCheck()
    await vi.advanceTimersByTimeAsync(7_200_000)

    expect(mockCheck).not.toHaveBeenCalled()
  })

  it('startPeriodicCheck is idempotent when called twice', async () => {
    useSettingsStore.setState({ settings: { 'updates.checkInterval': '1h' } })
    mockCheck.mockResolvedValue(null)

    await useUpdateStore.getState().startPeriodicCheck()
    await useUpdateStore.getState().startPeriodicCheck()
    expect(mockCheck).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(mockCheck).toHaveBeenCalledTimes(3)
  })

  it('stopPeriodicCheck clears the periodic timer', async () => {
    useSettingsStore.setState({ settings: { 'updates.checkInterval': '1h' } })
    mockCheck.mockResolvedValue(null)

    await useUpdateStore.getState().startPeriodicCheck()
    useUpdateStore.getState().stopPeriodicCheck()
    await vi.advanceTimersByTimeAsync(3_600_000)

    expect(mockCheck).toHaveBeenCalledTimes(1)
  })

  it('restartPeriodicCheck recreates the periodic timer', async () => {
    useSettingsStore.setState({ settings: { 'updates.checkInterval': '1h' } })
    mockCheck.mockResolvedValue(null)

    await useUpdateStore.getState().startPeriodicCheck()
    await useUpdateStore.getState().restartPeriodicCheck()

    expect(mockCheck).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(mockCheck).toHaveBeenCalledTimes(3)
  })

  it('all actions are no-ops when Tauri APIs are unavailable', async () => {
    mockHasTauriApis.mockReturnValue(false)

    await useUpdateStore.getState().checkForUpdate(true)
    await useUpdateStore.getState().downloadAndInstall()
    await useUpdateStore.getState().restartApp()
    await useUpdateStore.getState().startPeriodicCheck()
    await useUpdateStore.getState().restartPeriodicCheck()
    useUpdateStore.getState().stopPeriodicCheck()
    await vi.advanceTimersByTimeAsync(3_600_000)

    expect(mockCheck).not.toHaveBeenCalled()
    expect(mockRelaunch).not.toHaveBeenCalled()
    expect(useUpdateStore.getState()).toMatchObject({
      status: 'idle',
      availableVersion: null,
      downloadProgress: 0,
      updateObject: null,
    })
  })

  it.each([
    {
      platform: 'macos',
      version: '5.0.0',
      readyToFinishAction: 'relaunch',
      readyToFinishCta: 'Restart App',
      readyToFinishMessage: 'Restart SqlLumen to finish installing version 5.0.0.',
    },
    {
      platform: 'windows',
      version: '5.1.0',
      readyToFinishAction: 'relaunch',
      readyToFinishCta: 'Restart App',
      readyToFinishMessage: 'Restart SqlLumen to finish installing version 5.1.0.',
    },
    {
      platform: 'linux',
      version: '5.2.0',
      readyToFinishAction: 'manual-quit',
      readyToFinishCta: 'Got it',
      readyToFinishMessage: 'Quit and reopen SqlLumen to finish installing version 5.2.0.',
    },
  ] as const)(
    'setCurrentPlatform derives ready-to-finish metadata for $platform',
    ({ platform, version, readyToFinishAction, readyToFinishCta, readyToFinishMessage }) => {
      useUpdateStore.setState({ availableVersion: version })

      useUpdateStore.getState().setCurrentPlatform(platform)

      expect(useUpdateStore.getState()).toMatchObject({
        currentPlatform: platform,
        readyToFinishAction,
        readyToFinishCta,
        readyToFinishMessage,
      })
    }
  )

  it('automatic check errors are logged and keep status idle', async () => {
    mockCheck.mockRejectedValue(new Error('network down'))

    await useUpdateStore.getState().checkForUpdate(false)

    expect(mockLogFrontend).toHaveBeenCalledWith(
      'error',
      '[update-store] Automatic update check failed: network down'
    )
    expect(useUpdateStore.getState()).toMatchObject({
      status: 'idle',
      errorMessage: null,
    })
  })
})
