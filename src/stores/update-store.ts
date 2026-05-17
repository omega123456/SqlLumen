import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { platform } from '@tauri-apps/plugin-os'
import { create } from 'zustand'
import { hasTauriApis } from '../lib/tauri-env'
import { UPDATE_INTERVAL_MS } from '../lib/update-intervals'
import { useSettingsStore } from './settings-store'

import { logFrontend } from '../lib/app-log-commands'
type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'installing'
  | 'ready-to-finish'
  | 'error'

type UpdateProgressEvent =
  | { event: 'Started'; data?: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' }

type UpdatePlatform = 'macos' | 'windows' | 'linux' | 'unknown'
type ReadyToFinishAction = 'relaunch' | 'manual-quit'

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

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function resolveUpdatePlatform(platformValue: string | null | undefined): UpdatePlatform {
  if (platformValue === 'macos' || platformValue === 'windows' || platformValue === 'linux') {
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
    readyToFinishCta: 'Restart App',
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
  }, 5_000)
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
    if (
      state.status === 'checking' ||
      state.status === 'installing' ||
      state.status === 'ready-to-finish'
    ) {
      return
    }

    const wasAvailable = state.status === 'available'

    clearResetStatusTimer()

    if (!hasTauriApis()) {
      if (!wasAvailable) resetUpdateState(set)
      return
    }

    if (!wasAvailable) {
      set({
        status: 'checking',
        availableVersion: null,
        downloadProgress: 0,
        errorMessage: null,
        updateObject: null,
        ...getPlatformState(get().currentPlatform, null),
      })
    }

    try {
      const update = (await check()) as Update | null

      if (update) {
        set({
          status: 'available',
          availableVersion: update.version ?? null,
          errorMessage: null,
          downloadProgress: 0,
          updateObject: update,
          ...getPlatformState(get().currentPlatform, update.version ?? null),
        })
        return
      }

      if (wasAvailable) {
        return
      }

      if (manual) {
        scheduleUpToDateReset(set)
        return
      }

      resetUpdateState(set)
    } catch (error) {
      const message = toErrorMessage(error)
      logFrontend(
        'error',
        `[update-store] ${manual ? 'Manual' : 'Automatic'} update check failed: ${message}`
      )

      if (wasAvailable) {
        return
      }

      if (manual) {
        set({
          status: 'error',
          errorMessage: message,
          availableVersion: null,
          updateObject: null,
          ...getPlatformState(get().currentPlatform, null),
        })
        return
      }

      resetUpdateState(set)
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
          contentLength = typeof total === 'number' && total > 0 ? total : null
          downloaded = 0
          set({ downloadProgress: 0 })
          return
        }

        if (event.event === 'Progress') {
          downloaded += event.data.chunkLength
          if (contentLength && contentLength > 0) {
            const percent = Math.min(100, Math.round((downloaded / contentLength) * 100))
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
