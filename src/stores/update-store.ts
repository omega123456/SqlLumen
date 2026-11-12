import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { platform } from '@tauri-apps/plugin-os'
import { create } from 'zustand'
import { hasTauriApis } from '../lib/tauri-env'
import { UPDATE_INTERVAL_MS } from '../lib/update-intervals'
import { useSettingsStore } from './settings-store'

import { logFrontend } from '../lib/app-log-commands'
import { PERCENT_SCALE } from '../lib/units'
import { toErrorMessage } from '../lib/error-message'

const UP_TO_DATE_STATUS_RESET_DELAY_MS = 5_000
export type UpdateStatus =
  'idle' | 'checking' | 'up-to-date' | 'available' | 'installing' | 'ready-to-finish' | 'error'

type UpdateProgressEvent =
  | { event: 'Started'; data?: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' }

type UpdatePlatform = 'macos' | 'windows' | 'linux' | 'unknown'

const KNOWN_UPDATE_PLATFORMS: ReadonlySet<string | null | undefined> = new Set<UpdatePlatform>([
  'macos',
  'windows',
  'linux',
])

function isKnownUpdatePlatform(
  platformValue: string | null | undefined
): platformValue is UpdatePlatform {
  return KNOWN_UPDATE_PLATFORMS.has(platformValue)
}
export type ReadyToFinishAction = 'relaunch' | 'manual-quit'

let periodicTimer: ReturnType<typeof setInterval> | null = null
let resetStatusTimer: ReturnType<typeof setTimeout> | null = null
let periodicCheckGeneration = 0

function clearResetStatusTimer(): void {
  if (resetStatusTimer !== null) {
    clearTimeout(resetStatusTimer)
    resetStatusTimer = null
  }
}

function clearPeriodicTimer(): void {
  if (periodicTimer !== null) {
    clearInterval(periodicTimer)
    periodicTimer = null
  }
}

function resolveUpdatePlatform(platformValue: string | null | undefined): UpdatePlatform {
  if (isKnownUpdatePlatform(platformValue)) {
    return platformValue
  }

  return 'unknown'
}

function getReadyToFinishBehavior(
  currentPlatform: UpdatePlatform,
  availableVersion: string | null
): {
  readyToFinishAction: ReadyToFinishAction
  readyToFinishCta: string
  readyToFinishMessage: string
} {
  const version = availableVersion ?? 'the latest version'

  if (currentPlatform === 'linux') {
    return {
      readyToFinishAction: 'manual-quit',
      readyToFinishCta: 'Got it',
      readyToFinishMessage: `Quit and reopen SqlLumen to finish installing version ${version}.`,
    }
  }

  return {
    readyToFinishAction: 'relaunch',
    readyToFinishCta: 'Restart app',
    readyToFinishMessage: `Restart SqlLumen to finish installing version ${version}.`,
  }
}

function getPlatformState(currentPlatform: UpdatePlatform, availableVersion: string | null) {
  return {
    currentPlatform,
    ...getReadyToFinishBehavior(currentPlatform, availableVersion),
  }
}

async function detectPlatform(): Promise<UpdatePlatform> {
  if (!hasTauriApis()) {
    return 'unknown'
  }

  try {
    return resolveUpdatePlatform(await platform())
  } catch (error) {
    const message = toErrorMessage(error)
    logFrontend('error', `[update-store] Failed to detect platform: ${message}`)
    return 'unknown'
  }
}

function resetUpdateState(set: (partial: Partial<UpdateState>) => void): void {
  set({
    status: 'idle',
    availableVersion: null,
    downloadProgress: 0,
    errorMessage: null,
    updateObject: null,
    ...getPlatformState(useUpdateStore.getState().currentPlatform, null),
  })
}

function scheduleUpToDateReset(set: (partial: Partial<UpdateState>) => void): void {
  set({
    status: 'up-to-date',
    availableVersion: null,
    errorMessage: null,
    updateObject: null,
    ...getPlatformState(useUpdateStore.getState().currentPlatform, null),
  })
  resetStatusTimer = setTimeout(() => {
    resetStatusTimer = null
    useUpdateStore.setState((currentState) => {
      if (currentState.status !== 'up-to-date') {
        return currentState
      }

      return {
        ...currentState,
        status: 'idle',
        availableVersion: null,
        errorMessage: null,
        updateObject: null,
        ...getPlatformState(currentState.currentPlatform, null),
      }
    })
  }, UP_TO_DATE_STATUS_RESET_DELAY_MS)
}

type UpdateStateSetter = (partial: Partial<UpdateState>) => void

const BUSY_UPDATE_STATUSES = new Set<UpdateStatus>(['checking', 'installing', 'ready-to-finish'])

interface UpdateCheckContext {
  manual: boolean
  wasAvailable: boolean
}

interface UpdateCheckFailure {
  context: UpdateCheckContext
  error: unknown
}

async function checkForAvailableUpdate(): Promise<Update | null> {
  return (await check()) as Update | null
}

function markUpdateChecking(set: UpdateStateSetter): void {
  set({
    status: 'checking',
    availableVersion: null,
    downloadProgress: 0,
    errorMessage: null,
    updateObject: null,
    ...getPlatformState(useUpdateStore.getState().currentPlatform, null),
  })
}

function markUpdateAvailable(set: UpdateStateSetter, update: Update): void {
  const availableVersion = update.version ?? null
  set({
    status: 'available',
    availableVersion: availableVersion,
    errorMessage: null,
    downloadProgress: 0,
    updateObject: update,
    ...getPlatformState(useUpdateStore.getState().currentPlatform, availableVersion),
  })
}

function settleNoUpdateFound(set: UpdateStateSetter, context: UpdateCheckContext): void {
  if (context.wasAvailable) {
    return
  }

  if (context.manual) {
    scheduleUpToDateReset(set)
    return
  }

  resetUpdateState(set)
}

function settleUpdateCheckFailure(set: UpdateStateSetter, failure: UpdateCheckFailure): void {
  const { context } = failure
  const message = toErrorMessage(failure.error)
  const checkKind = context.manual ? 'Manual' : 'Automatic'
  logFrontend('error', `[update-store] ${checkKind} update check failed: ${message}`)

  if (context.wasAvailable) {
    return
  }

  if (context.manual) {
    set({
      status: 'error',
      errorMessage: message,
      availableVersion: null,
      updateObject: null,
      ...getPlatformState(useUpdateStore.getState().currentPlatform, null),
    })
    return
  }

  resetUpdateState(set)
}

interface UpdateState {
  status: UpdateStatus
  currentPlatform: UpdatePlatform
  readyToFinishAction: ReadyToFinishAction
  readyToFinishCta: string
  readyToFinishMessage: string
  availableVersion: string | null
  downloadProgress: number
  errorMessage: string | null
  updateObject: Update | null
  setCurrentPlatform: (platformValue: UpdatePlatform) => void
  checkForUpdate: (manual: boolean) => Promise<void>
  downloadAndInstall: () => Promise<void>
  restartApp: () => Promise<void>
  startPeriodicCheck: () => Promise<void>
  stopPeriodicCheck: () => void
  restartPeriodicCheck: () => Promise<void>
}

export const useUpdateStore = create<UpdateState>()((set, get) => ({
  status: 'idle',
  ...getPlatformState('unknown', null),
  availableVersion: null,
  downloadProgress: 0,
  errorMessage: null,
  updateObject: null,

  setCurrentPlatform: (platformValue: UpdatePlatform) => {
    set((state) => ({
      ...state,
      ...getPlatformState(platformValue, state.availableVersion),
    }))
  },

  checkForUpdate: async (manual: boolean) => {
    const state = get()
    if (BUSY_UPDATE_STATUSES.has(state.status)) {
      return
    }

    const checkContext: UpdateCheckContext = {
      manual: manual,
      wasAvailable: state.status === 'available',
    }

    clearResetStatusTimer()

    if (!hasTauriApis()) {
      if (!checkContext.wasAvailable) resetUpdateState(set)
      return
    }

    if (!checkContext.wasAvailable) {
      markUpdateChecking(set)
    }

    try {
      const update = await checkForAvailableUpdate()
      if (update) {
        markUpdateAvailable(set, update)
        return
      }
      settleNoUpdateFound(set, checkContext)
    } catch (error) {
      settleUpdateCheckFailure(set, { context: checkContext, error: error })
    }
  },

  downloadAndInstall: async () => {
    clearResetStatusTimer()
    const updateObject = get().updateObject

    if (!hasTauriApis()) {
      set({
        status: 'idle',
        errorMessage: null,
        updateObject: null,
        ...getPlatformState(get().currentPlatform, get().availableVersion),
      })
      return
    }

    if (!updateObject) {
      const message = 'No update is available to install.'
      logFrontend('error', `[update-store] Install failed: ${message}`)
      set({
        status: 'error',
        errorMessage: message,
        updateObject: null,
        ...getPlatformState(get().currentPlatform, get().availableVersion),
      })
      return
    }

    let contentLength: number | null = null
    let downloaded = 0

    set({ status: 'installing', downloadProgress: 0, errorMessage: null })

    try {
      await updateObject.downloadAndInstall((event: UpdateProgressEvent) => {
        if (event.event === 'Started') {
          const total = event.data?.contentLength
          const isKnownLength = typeof total === 'number' && total > 0
          contentLength = isKnownLength ? total : null
          downloaded = 0
          set({ downloadProgress: 0 })
          return
        }

        if (event.event === 'Progress') {
          downloaded += event.data.chunkLength
          if (contentLength) {
            const percent = Math.min(
              PERCENT_SCALE,
              Math.round((downloaded / contentLength) * PERCENT_SCALE)
            )
            set({ downloadProgress: percent })
          }
          return
        }

        if (event.event === 'Finished') {
          set({ downloadProgress: 100 })
        }
      })

      set({ updateObject: null })

      const currentPlatform = await detectPlatform()
      set((state) => ({
        ...state,
        ...getPlatformState(currentPlatform, state.availableVersion),
      }))

      if (currentPlatform === 'macos') {
        await relaunch()
        return
      }

      set({
        status: 'ready-to-finish',
        availableVersion: updateObject.version ?? null,
        downloadProgress: 100,
        errorMessage: null,
        updateObject: null,
        ...getPlatformState(currentPlatform, updateObject.version ?? null),
      })
    } catch (error) {
      const message = toErrorMessage(error)
      logFrontend('error', `[update-store] Install failed: ${message}`)
      set((state) => ({
        status: 'error',
        errorMessage: message,
        updateObject: null,
        ...getPlatformState(state.currentPlatform, state.availableVersion),
      }))
    }
  },

  restartApp: async () => {
    if (!hasTauriApis()) {
      return
    }

    try {
      const currentPlatform = await detectPlatform()
      set((state) => ({
        ...state,
        ...getPlatformState(currentPlatform, state.availableVersion),
      }))

      if (currentPlatform === 'linux') {
        return
      }

      await relaunch()
    } catch (error) {
      const message = toErrorMessage(error)
      logFrontend('error', `[update-store] Restart failed: ${message}`)
      set((state) => ({
        status: state.status === 'ready-to-finish' ? 'ready-to-finish' : 'error',
        errorMessage: message,
        ...getPlatformState(state.currentPlatform, state.availableVersion),
      }))
    }
  },

  startPeriodicCheck: async () => {
    clearPeriodicTimer()
    const generation = ++periodicCheckGeneration

    if (!hasTauriApis()) {
      return
    }

    const intervalKey = useSettingsStore.getState().getSetting('updates.checkInterval')
    const intervalMs = UPDATE_INTERVAL_MS[intervalKey as keyof typeof UPDATE_INTERVAL_MS]

    if (!intervalMs) {
      return
    }

    await get().checkForUpdate(false)

    if (generation !== periodicCheckGeneration) {
      return
    }

    periodicTimer = setInterval(() => {
      void useUpdateStore.getState().checkForUpdate(false)
    }, intervalMs)
  },

  stopPeriodicCheck: () => {
    periodicCheckGeneration += 1
    clearPeriodicTimer()
    clearResetStatusTimer()
  },

  restartPeriodicCheck: async () => {
    get().stopPeriodicCheck()
    await get().startPeriodicCheck()
  },
}))

void detectPlatform().then((currentPlatform) => {
  useUpdateStore.getState().setCurrentPlatform(currentPlatform)
})
