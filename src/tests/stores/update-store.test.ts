import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ipc } from '../ipc-mock'
import { useSettingsStore } from '../../stores/settings-store'
import { useUpdateStore } from '../../stores/update-store'

type MockProgressEvent =
  | { event: 'Started'; data?: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' }

type TauriTestWindow = Window & {
  __TAURI_INTERNALS__?: unknown
  __TAURI_OS_PLUGIN_INTERNALS__?: { platform: string }
}

type WindowPropertySnapshot = {
  hadValue: boolean
  value: unknown
}

function makeAvailableUpdateMetadata(version = '2.0.0') {
  return {
    rid: 101,
    version,
    currentVersion: '1.0.0',
    date: '2026-05-17T12:00:00.000Z',
    body: `Release ${version}`,
    rawJson: null,
  }
}

function overrideAvailableUpdate(
  version = '2.0.0',
  progressChunks: number[] = [100],
  options?: { downloadError?: string; emitFinished?: boolean }
): void {
  ipc.override('plugin:updater|check', () => makeAvailableUpdateMetadata(version))
  ipc.override('plugin:updater|download_and_install', (args) => {
    const onEvent = args?.onEvent as { onmessage?: (event: MockProgressEvent) => void } | undefined

    onEvent?.onmessage?.({ event: 'Started', data: { contentLength: 100 } })
    for (const chunkLength of progressChunks) {
      onEvent?.onmessage?.({ event: 'Progress', data: { chunkLength } })
    }
    if (options?.emitFinished ?? true) {
      onEvent?.onmessage?.({ event: 'Finished' })
    }

    if (options?.downloadError) {
      throw new Error(options.downloadError)
    }

    return null
  })
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

function captureWindowProperty<K extends keyof TauriTestWindow>(property: K): WindowPropertySnapshot {
  return {
    hadValue: property in window,
    value: (window as TauriTestWindow)[property],
  }
}

function restoreWindowProperty<K extends keyof TauriTestWindow>(
  property: K,
  snapshot: WindowPropertySnapshot
): void {
  if (snapshot.hadValue) {
    ;(window as TauriTestWindow)[property] = snapshot.value as TauriTestWindow[K]
    return
  }

  delete (window as TauriTestWindow)[property]
}

function setMockPlatform(platform: 'macos' | 'windows' | 'linux'): void {
  ;(window as TauriTestWindow).__TAURI_OS_PLUGIN_INTERNALS__ = { platform }
}

describe('useUpdateStore', () => {
  let tauriInternalsSnapshot: WindowPropertySnapshot
  let osPluginInternalsSnapshot: WindowPropertySnapshot

  beforeEach(() => {
    vi.useFakeTimers()
    resetStores()
    tauriInternalsSnapshot = captureWindowProperty('__TAURI_INTERNALS__')
    osPluginInternalsSnapshot = captureWindowProperty('__TAURI_OS_PLUGIN_INTERNALS__')
    setMockPlatform('macos')
  })

  afterEach(() => {
    useUpdateStore.getState().stopPeriodicCheck()
    restoreWindowProperty('__TAURI_INTERNALS__', tauriInternalsSnapshot)
    restoreWindowProperty('__TAURI_OS_PLUGIN_INTERNALS__', osPluginInternalsSnapshot)
    vi.useRealTimers()
  })

  it('manual check sets available state when update exists', async () => {
    overrideAvailableUpdate()

    await useUpdateStore.getState().checkForUpdate(true)

    expect(ipc.calls('plugin:updater|check')).toHaveLength(1)
    expect(useUpdateStore.getState()).toMatchObject({
      status: 'available',
      availableVersion: '2.0.0',
      errorMessage: null,
    })
    expect(useUpdateStore.getState().updateObject).not.toBeNull()
  })

  it('manual check errors set error state and message', async () => {
    ipc.override('plugin:updater|check', () => {
      throw new Error('manual failure')
    })

    await useUpdateStore.getState().checkForUpdate(true)

    expect(ipc.calls('log_frontend')).toContainEqual({
      level: 'error',
      message: '[update-store] Manual update check failed: manual failure',
    })
    expect(useUpdateStore.getState()).toMatchObject({
      status: 'error',
      errorMessage: 'manual failure',
    })
  })

  it('manual check with no update shows up-to-date then returns to idle after 5 seconds', async () => {
    ipc.override('plugin:updater|check', () => null)

    await useUpdateStore.getState().checkForUpdate(true)
    expect(useUpdateStore.getState().status).toBe('up-to-date')

    await vi.advanceTimersByTimeAsync(4_999)
    expect(useUpdateStore.getState().status).toBe('up-to-date')

    await vi.advanceTimersByTimeAsync(1)
    expect(useUpdateStore.getState().status).toBe('idle')
  })

  it('automatic check with no update returns to idle directly', async () => {
    ipc.override('plugin:updater|check', () => null)

    await useUpdateStore.getState().checkForUpdate(false)

    expect(useUpdateStore.getState()).toMatchObject({
      status: 'idle',
      availableVersion: null,
      errorMessage: null,
    })
  })

  it('check from error state resets to checking and proceeds', async () => {
    useUpdateStore.setState({ status: 'error', errorMessage: 'previous failure' })
    ipc.override('plugin:updater|check', () => null)

    const pending = useUpdateStore.getState().checkForUpdate(true)
    expect(useUpdateStore.getState()).toMatchObject({ status: 'checking', errorMessage: null })

    await pending
    expect(useUpdateStore.getState().status).toBe('up-to-date')
  })

  it('ignores overlapping checks while already checking', async () => {
    let resolveCheck: ((value: ReturnType<typeof makeAvailableUpdateMetadata> | null) => void) | undefined
    ipc.override(
      'plugin:updater|check',
      () =>
        new Promise<ReturnType<typeof makeAvailableUpdateMetadata> | null>((resolve) => {
          resolveCheck = resolve
        })
    )

    const firstCheck = useUpdateStore.getState().checkForUpdate(true)
    const secondCheck = useUpdateStore.getState().checkForUpdate(true)

    expect(ipc.calls('plugin:updater|check')).toHaveLength(1)

    resolveCheck?.(null)
    await firstCheck
    await secondCheck
  })

  it('ignores checks while installing', async () => {
    useUpdateStore.setState({ status: 'installing' })

    await useUpdateStore.getState().checkForUpdate(true)

    expect(ipc.calls('plugin:updater|check')).toHaveLength(0)
  })

  it('cancels pending up-to-date timeout when a new check starts', async () => {
    ipc.override('plugin:updater|check', () => null)

    await useUpdateStore.getState().checkForUpdate(true)
    expect(useUpdateStore.getState().status).toBe('up-to-date')

    overrideAvailableUpdate('3.1.0')

    await useUpdateStore.getState().checkForUpdate(true)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(useUpdateStore.getState().status).toBe('available')
    expect(useUpdateStore.getState().availableVersion).toBe('3.1.0')
  })

  it('downloadAndInstall tracks progress and relaunches after finish on macOS', async () => {
    overrideAvailableUpdate('4.0.0', [25, 25, 50])
    await useUpdateStore.getState().checkForUpdate(true)

    await useUpdateStore.getState().downloadAndInstall()

    expect(ipc.calls('plugin:updater|download_and_install')).toHaveLength(1)
    expect(useUpdateStore.getState()).toMatchObject({
      status: 'installing',
      downloadProgress: 100,
      errorMessage: null,
      updateObject: null,
    })
    expect(ipc.calls('plugin:process|restart')).toHaveLength(1)
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
      setMockPlatform(platform)

      overrideAvailableUpdate(version)
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
      expect(ipc.calls('plugin:process|restart')).toHaveLength(0)
    }
  )

  it('restartApp relaunches on Windows from ready-to-finish', async () => {
    setMockPlatform('windows')
    setReadyToFinishState('4.0.0', 'windows')

    await useUpdateStore.getState().restartApp()

    expect(ipc.calls('plugin:process|restart')).toHaveLength(1)
  })

  it('restartApp does not relaunch on Linux from ready-to-finish', async () => {
    setMockPlatform('linux')
    setReadyToFinishState('4.1.0', 'linux')

    await useUpdateStore.getState().restartApp()

    expect(ipc.calls('plugin:process|restart')).toHaveLength(0)
    expect(useUpdateStore.getState()).toMatchObject({
      status: 'ready-to-finish',
      availableVersion: '4.1.0',
      downloadProgress: 100,
    })
  })

  it('restartApp keeps ready-to-finish state when relaunch fails', async () => {
    setMockPlatform('windows')
    ipc.override('plugin:process|restart', () => {
      throw new Error('restart failed')
    })
    setReadyToFinishState('4.0.0', 'windows')

    await useUpdateStore.getState().restartApp()

    expect(ipc.calls('log_frontend')).toContainEqual({
      level: 'error',
      message: '[update-store] Restart failed: restart failed',
    })
    expect(useUpdateStore.getState()).toMatchObject({
      status: 'ready-to-finish',
      availableVersion: '4.0.0',
      downloadProgress: 100,
      errorMessage: 'restart failed',
    })
  })

  it('downloadAndInstall stores error state on failure', async () => {
    overrideAvailableUpdate('4.0.0', [40], {
      downloadError: 'download failed',
      emitFinished: false,
    })
    await useUpdateStore.getState().checkForUpdate(true)

    await useUpdateStore.getState().downloadAndInstall()

    expect(useUpdateStore.getState()).toMatchObject({
      status: 'error',
      downloadProgress: 40,
      errorMessage: 'download failed',
    })
    expect(ipc.calls('log_frontend')).toContainEqual({
      level: 'error',
      message: '[update-store] Install failed: download failed',
    })
    expect(ipc.calls('plugin:process|restart')).toHaveLength(0)
  })

  it('allows re-checks when update is already available to catch newer versions', async () => {
    useUpdateStore.setState({ status: 'available', availableVersion: '1.2.3' })
    ipc.override('plugin:updater|check', () => makeAvailableUpdateMetadata('1.2.4'))

    await useUpdateStore.getState().checkForUpdate(false)

    expect(ipc.calls('plugin:updater|check')).toHaveLength(1)
    expect(useUpdateStore.getState().availableVersion).toBe('1.2.4')
  })

  it('keeps cached update when re-check from available returns null', async () => {
    useUpdateStore.setState({ status: 'available', availableVersion: '1.2.3' })
    ipc.override('plugin:updater|check', () => null)

    await useUpdateStore.getState().checkForUpdate(false)

    expect(ipc.calls('plugin:updater|check')).toHaveLength(1)
    expect(useUpdateStore.getState().status).toBe('available')
    expect(useUpdateStore.getState().availableVersion).toBe('1.2.3')
  })

  it('does not create interval if periodic check was stopped during initial await', async () => {
    useSettingsStore.setState({ settings: { 'updates.checkInterval': '1h' } })

    let resolveCheck: (() => void) | undefined
    ipc.override(
      'plugin:updater|check',
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
    expect(ipc.calls('plugin:updater|check')).toHaveLength(1)
  })

  it('startPeriodicCheck with 1h interval runs immediately and again after interval', async () => {
    useSettingsStore.setState({ settings: { 'updates.checkInterval': '1h' } })
    ipc.override('plugin:updater|check', () => null)

    await useUpdateStore.getState().startPeriodicCheck()

    expect(ipc.calls('plugin:updater|check')).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(ipc.calls('plugin:updater|check')).toHaveLength(2)
  })

  it('startPeriodicCheck with off does not schedule or run immediate checks', async () => {
    useSettingsStore.setState({ settings: { 'updates.checkInterval': 'off' } })

    await useUpdateStore.getState().startPeriodicCheck()
    await vi.advanceTimersByTimeAsync(7_200_000)

    expect(ipc.calls('plugin:updater|check')).toHaveLength(0)
  })

  it('startPeriodicCheck is idempotent when called twice', async () => {
    useSettingsStore.setState({ settings: { 'updates.checkInterval': '1h' } })
    ipc.override('plugin:updater|check', () => null)

    await useUpdateStore.getState().startPeriodicCheck()
    await useUpdateStore.getState().startPeriodicCheck()
    expect(ipc.calls('plugin:updater|check')).toHaveLength(2)

    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(ipc.calls('plugin:updater|check')).toHaveLength(3)
  })

  it('stopPeriodicCheck clears the periodic timer', async () => {
    useSettingsStore.setState({ settings: { 'updates.checkInterval': '1h' } })
    ipc.override('plugin:updater|check', () => null)

    await useUpdateStore.getState().startPeriodicCheck()
    useUpdateStore.getState().stopPeriodicCheck()
    await vi.advanceTimersByTimeAsync(3_600_000)

    expect(ipc.calls('plugin:updater|check')).toHaveLength(1)
  })

  it('restartPeriodicCheck recreates the periodic timer', async () => {
    useSettingsStore.setState({ settings: { 'updates.checkInterval': '1h' } })
    ipc.override('plugin:updater|check', () => null)

    await useUpdateStore.getState().startPeriodicCheck()
    await useUpdateStore.getState().restartPeriodicCheck()

    expect(ipc.calls('plugin:updater|check')).toHaveLength(2)

    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(ipc.calls('plugin:updater|check')).toHaveLength(3)
  })

  it('all actions are no-ops when Tauri APIs are unavailable', async () => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__

    await useUpdateStore.getState().checkForUpdate(true)
    await useUpdateStore.getState().downloadAndInstall()
    await useUpdateStore.getState().restartApp()
    await useUpdateStore.getState().startPeriodicCheck()
    await useUpdateStore.getState().restartPeriodicCheck()
    useUpdateStore.getState().stopPeriodicCheck()
    await vi.advanceTimersByTimeAsync(3_600_000)

    expect(ipc.calls('plugin:updater|check')).toHaveLength(0)
    expect(ipc.calls('plugin:process|restart')).toHaveLength(0)
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
    ipc.override('plugin:updater|check', () => {
      throw new Error('network down')
    })

    await useUpdateStore.getState().checkForUpdate(false)

    expect(ipc.calls('log_frontend')).toContainEqual({
      level: 'error',
      message: '[update-store] Automatic update check failed: network down',
    })
    expect(useUpdateStore.getState()).toMatchObject({
      status: 'idle',
      errorMessage: null,
    })
  })
})
