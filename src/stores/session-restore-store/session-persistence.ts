import { milliseconds } from 'date-fns'
import { logFrontend } from '../../lib/app-log-commands'
import { showErrorToast } from '../toast-store'
import { saveSessionState } from '../../lib/session-restore-commands'
import { hasTauriApis, hasWindow } from '../../lib/tauri-env'
import { toErrorMessage } from '../../lib/error-message'
import { useSessionRestoreStore } from '../session-restore-store'
import { buildSessionState } from './session-serialization'

const SESSION_AUTOSAVE_INTERVAL_MINUTES = 5

export const SESSION_AUTOSAVE_INTERVAL_MS = milliseconds({
  minutes: SESSION_AUTOSAVE_INTERVAL_MINUTES,
})

interface CloseRequestedEvent {
  preventDefault: () => void
}

interface SessionPersistenceWindow {
  onCloseRequested: (
    handler: (event: CloseRequestedEvent) => Promise<void> | void
  ) => Promise<unknown>
  destroy: () => Promise<void>
}

export interface SaveSessionOptions {
  throwOnError?: boolean
}

type LoadTauriWindowApi = () => Promise<{ getCurrentWindow: () => SessionPersistenceWindow }>

const defaultLoadTauriWindowApi: LoadTauriWindowApi = async () => import('@tauri-apps/api/window')

let autoSaveIntervalId: number | null = null

let closeHandlerRegistered = false

let saveSessionInFlight: Promise<void> | null = null

let saveSessionRequestId = 0

let saveSessionCompletedRequestId = 0

interface SaveSessionWaiter {
  resolve: () => void
  reject: (error: Error) => void
}

const saveSessionWaiters = new Map<number, SaveSessionWaiter>()

let loadTauriWindowApi: LoadTauriWindowApi = defaultLoadTauriWindowApi

const preCloseHooks: Array<() => Promise<void>> = []

export function registerPreCloseHook(hook: () => Promise<void>): void {
  preCloseHooks.push(hook)
}

export async function saveSession(options?: SaveSessionOptions): Promise<void> {
  if (!useSessionRestoreStore.getState().isEnabled()) return
  if (!useSessionRestoreStore.getState().canPersistSession()) return

  const requestId = ++saveSessionRequestId
  const waitForSave = new Promise<void>((resolve, reject) => {
    saveSessionWaiters.set(requestId, { resolve, reject })
  })

  if (!saveSessionInFlight) {
    saveSessionInFlight = runSaveSessionQueue().finally(() => {
      saveSessionInFlight = null
    })
  }

  if (options?.throwOnError) {
    await waitForSave
    return
  }

  await waitForSave.catch((error: unknown) => {
    logFrontend(
      'debug',
      `[session-restore] Session save failed for a caller that does not rethrow: ${String(error)}`
    )
  })
}

async function saveCurrentSessionState(): Promise<Error | null> {
  try {
    await saveSessionState(buildSessionState())
    return null
  } catch (caughtError) {
    const error = caughtError instanceof Error ? caughtError : new Error(String(caughtError))
    logFrontend('error', `[session-restore] Failed to save session state: ${error.message}`)
    return error
  }
}

function settleWaitersUpTo(requestId: number, error: Error | null): void {
  const completedRequestIds = [...saveSessionWaiters.keys()]
    .filter((waiterRequestId) => waiterRequestId <= requestId)
    .sort((left, right) => left - right)
  for (const completedRequestId of completedRequestIds) {
    const waiter = saveSessionWaiters.get(completedRequestId)
    if (!waiter) continue
    saveSessionWaiters.delete(completedRequestId)
    settleSaveWaiter(waiter, error)
  }
}

async function runSaveSessionQueue(): Promise<void> {
  while (saveSessionCompletedRequestId < saveSessionRequestId) {
    const requestId = saveSessionRequestId
    const error = await saveCurrentSessionState()
    saveSessionCompletedRequestId = requestId
    settleWaitersUpTo(requestId, error)
  }
}

function settleSaveWaiter(waiter: SaveSessionWaiter, error: Error | null): void {
  if (error) {
    waiter.reject(error)
    return
  }
  waiter.resolve()
}

function registerAutoSaveInterval(): void {
  if (!hasWindow()) return
  if (autoSaveIntervalId != null) return

  autoSaveIntervalId = window.setInterval(() => {
    void useSessionRestoreStore.getState().saveSession()
  }, SESSION_AUTOSAVE_INTERVAL_MS)
}

export function _resetSessionPersistenceForTests(): void {
  const intervalId = autoSaveIntervalId
  const hasAutoSaveInterval = intervalId != null && hasWindow()
  if (hasAutoSaveInterval) {
    window.clearInterval(intervalId)
  }
  autoSaveIntervalId = null
  closeHandlerRegistered = false
  saveSessionInFlight = null
  saveSessionRequestId = 0
  saveSessionCompletedRequestId = 0
  saveSessionWaiters.clear()
  loadTauriWindowApi = defaultLoadTauriWindowApi
  preCloseHooks.length = 0
}

export function _setLoadTauriWindowApiForTests(loader: LoadTauriWindowApi): void {
  loadTauriWindowApi = loader
}

export async function registerCloseHandler(): Promise<void> {
  if (!hasTauriApis()) {
    return
  }

  registerAutoSaveInterval()

  if (closeHandlerRegistered) {
    return
  }

  try {
    const { getCurrentWindow } = await loadTauriWindowApi()
    const appWindow = getCurrentWindow()

    await appWindow.onCloseRequested(async (event) => {
      event.preventDefault()
      try {
        await useSessionRestoreStore.getState().saveSession({ throwOnError: true })
      } catch (error) {
        const message = toErrorMessage(error)
        showErrorToast('Session save failed', 'Could not save the current session before closing.')
        logFrontend('error', `[session-restore] Error saving session on close: ${message}`)
        return
      }

      for (const hook of preCloseHooks) {
        try {
          await hook()
        } catch (error) {
          const message = toErrorMessage(error)
          logFrontend('error', `[session-restore] Pre-close hook failed: ${message}`)
        }
      }

      await appWindow.destroy()
    })
    closeHandlerRegistered = true
  } catch (error) {
    const message = toErrorMessage(error)
    logFrontend('warn', `[session-restore] Failed to register close handler: ${message}`)
  }
}
