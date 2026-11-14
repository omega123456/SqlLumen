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
import {
  getPlatformState,
  type ReadyToFinishAction,
  type UpdatePlatform,
} from './update-store/update-platform'
import {
  clearUpToDateStatus,
  failInstall,
  failRestart,
  withDetectedPlatform,
} from './update-store/update-reducers'

export type { ReadyToFinishAction }

const UP_TO_DATE_STATUS_RESET_DELAY_MS = 5_000

export type UpdateStatus =
  'idle' | 'checking' | 'up-to-date' | 'available' | 'installing' | 'ready-to-finish' | 'error'

type UpdateProgressEvent =
  | { event: 'Started'; data?: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' }

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
    useUpdateStore.setState(clearUpToDateStatus)
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
  return await check()
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

export interface UpdateState {
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

function setCurrentPlatform(platformValue: UpdatePlatform): void {
  useUpdateStore.setState((state) => withDetectedPlatform(state, platformValue))
}

async function checkForUpdate(manual: boolean): Promise<void> {
  const state = useUpdateStore.getState()
  if (BUSY_UPDATE_STATUSES.has(state.status)) {
    return
  }

  const checkContext: UpdateCheckContext = {
    manual: manual,
    wasAvailable: state.status === 'available',
  }

  clearResetStatusTimer()

  if (!hasTauriApis()) {
    if (!checkContext.wasAvailable) resetUpdateState(useUpdateStore.setState)
    return
  }

  if (!checkContext.wasAvailable) {
    markUpdateChecking(useUpdateStore.setState)
  }

  try {
    const update = await checkForAvailableUpdate()
    if (update) {
      markUpdateAvailable(useUpdateStore.setState, update)
      return
    }
    settleNoUpdateFound(useUpdateStore.setState, checkContext)
  } catch (error) {
    settleUpdateCheckFailure(useUpdateStore.setState, { context: checkContext, error: error })
  }
}

function platformStateForAvailableVersion() {
  const { currentPlatform, availableVersion } = useUpdateStore.getState()
  return getPlatformState(currentPlatform, availableVersion)
}

function resetInstallWithoutTauri(): void {
  useUpdateStore.setState({
    status: 'idle',
    errorMessage: null,
    updateObject: null,
    ...platformStateForAvailableVersion(),
  })
}

function failInstallWithoutUpdate(): void {
  const message = 'No update is available to install.'
  logFrontend('error', `[update-store] Install failed: ${message}`)
  useUpdateStore.setState({
    status: 'error',
    errorMessage: message,
    updateObject: null,
    ...platformStateForAvailableVersion(),
  })
}

function downloadProgressPercent(downloaded: number, contentLength: number): number {
  return Math.min(PERCENT_SCALE, Math.round((downloaded / contentLength) * PERCENT_SCALE))
}

function createDownloadProgressHandler(): (event: UpdateProgressEvent) => void {
  let contentLength: number | null = null
  let downloaded = 0
  return (event) => {
    if (event.event === 'Started') {
      const total = event.data?.contentLength
      const isKnownLength = typeof total === 'number' && total > 0
      contentLength = isKnownLength ? total : null
      downloaded = 0
      useUpdateStore.setState({ downloadProgress: 0 })
      return
    }
    if (event.event === 'Progress') {
      downloaded += event.data.chunkLength
      if (contentLength) {
        useUpdateStore.setState({
          downloadProgress: downloadProgressPercent(downloaded, contentLength),
        })
      }
      return
    }
    if (event.event === 'Finished') {
      useUpdateStore.setState({ downloadProgress: 100 })
    }
  }
}

async function finishInstalledUpdate(updateObject: Update): Promise<void> {
  useUpdateStore.setState({ updateObject: null })

  const currentPlatform = await detectPlatform()
  useUpdateStore.setState((state) => withDetectedPlatform(state, currentPlatform))

  if (currentPlatform === 'macos') {
    await relaunch()
    return
  }

  useUpdateStore.setState({
    status: 'ready-to-finish',
    availableVersion: updateObject.version ?? null,
    downloadProgress: 100,
    errorMessage: null,
    updateObject: null,
    ...getPlatformState(currentPlatform, updateObject.version ?? null),
  })
}

async function downloadAndInstall(): Promise<void> {
  clearResetStatusTimer()
  const updateObject = useUpdateStore.getState().updateObject

  if (!hasTauriApis()) {
    resetInstallWithoutTauri()
    return
  }
  if (!updateObject) {
    failInstallWithoutUpdate()
    return
  }

  useUpdateStore.setState({ status: 'installing', downloadProgress: 0, errorMessage: null })

  try {
    await updateObject.downloadAndInstall(createDownloadProgressHandler())
    await finishInstalledUpdate(updateObject)
  } catch (error) {
    const message = toErrorMessage(error)
    logFrontend('error', `[update-store] Install failed: ${message}`)
    useUpdateStore.setState((state) => failInstall(state, message))
  }
}

async function restartApp(): Promise<void> {
  if (!hasTauriApis()) {
    return
  }

  try {
    const currentPlatform = await detectPlatform()
    useUpdateStore.setState((state) => withDetectedPlatform(state, currentPlatform))

    if (currentPlatform === 'linux') {
      return
    }

    await relaunch()
  } catch (error) {
    const message = toErrorMessage(error)
    logFrontend('error', `[update-store] Restart failed: ${message}`)
    useUpdateStore.setState((state) => failRestart(state, message))
  }
}

async function startPeriodicCheck(): Promise<void> {
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

  await useUpdateStore.getState().checkForUpdate(false)

  if (generation !== periodicCheckGeneration) {
    return
  }

  periodicTimer = setInterval(() => {
    void useUpdateStore.getState().checkForUpdate(false)
  }, intervalMs)
}

function stopPeriodicCheck(): void {
  periodicCheckGeneration += 1
  clearPeriodicTimer()
  clearResetStatusTimer()
}

async function restartPeriodicCheck(): Promise<void> {
  useUpdateStore.getState().stopPeriodicCheck()
  await useUpdateStore.getState().startPeriodicCheck()
}

export const useUpdateStore = create<UpdateState>()(() => ({
  status: 'idle',
  ...getPlatformState('unknown', null),
  availableVersion: null,
  downloadProgress: 0,
  errorMessage: null,
  updateObject: null,
  setCurrentPlatform: setCurrentPlatform,
  checkForUpdate: checkForUpdate,
  downloadAndInstall: downloadAndInstall,
  restartApp: restartApp,
  startPeriodicCheck: startPeriodicCheck,
  stopPeriodicCheck: stopPeriodicCheck,
  restartPeriodicCheck: restartPeriodicCheck,
}))

void detectPlatform().then((currentPlatform) => {
  useUpdateStore.getState().setCurrentPlatform(currentPlatform)
})
