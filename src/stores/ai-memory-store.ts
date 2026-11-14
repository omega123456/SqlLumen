import { create } from 'zustand'
import { listen } from '@tauri-apps/api/event'
import type { MemoryReembedProgress } from '../lib/ai-memory-commands'
import { reembedAllMemories } from '../lib/ai-memory-commands'
import { hasTauriApis } from '../lib/tauri-env'
import { useSettingsStore } from './settings-store'

import { logFrontend } from '../lib/app-log-commands'
import { putReembedStatus } from './ai-memory-store/ai-memory-reducers'

export interface ReembedStatus {
  status: 'idle' | 'running'
  done: number
  total: number
}

export interface AiMemoryState {
  reembedStatus: Record<string, ReembedStatus>
  setReembedStatus: (ownerKey: string, status: ReembedStatus) => void
}

export const useAiMemoryStore = create<AiMemoryState>()((set) => ({
  reembedStatus: {},

  setReembedStatus: (ownerKey, status) => {
    set((state) => putReembedStatus(state, { ownerKey: ownerKey, status: status }))
  },
}))

let initialized = false
let unsubscribeModelChange: (() => void) | null = null

export function _resetAiMemoryStoreForTest(): void {
  initialized = false
  if (unsubscribeModelChange) {
    unsubscribeModelChange()
    unsubscribeModelChange = null
  }
  for (const key of Object.keys(resetTimers)) {
    clearTimeout(resetTimers[key])
    delete resetTimers[key]
  }
}

export function initAiMemoryStore(): void {
  if (initialized) return
  initialized = true

  initEventListeners()
  initModelChangeSubscription()
}

const resetTimers: Record<string, ReturnType<typeof setTimeout>> = {}
const REEMBED_STATUS_RESET_DELAY_MS = 2000

function cancelResetTimer(ownerKey: string): void {
  if (resetTimers[ownerKey]) {
    clearTimeout(resetTimers[ownerKey])
    delete resetTimers[ownerKey]
  }
}

function setReembedStatus(ownerKey: string, status: ReembedStatus): void {
  useAiMemoryStore.getState().setReembedStatus(ownerKey, status)
}

const IDLE_REEMBED_STATUS: ReembedStatus = { status: 'idle', done: 0, total: 0 }

const REEMBED_PHASE_HANDLERS: Record<
  MemoryReembedProgress['phase'],
  (progress: MemoryReembedProgress) => void
> = {
  embedding: (progress) =>
    setReembedStatus(progress.ownerKey, {
      status: 'running',
      done: progress.done,
      total: progress.total,
    }),
  error: (progress) => {
    logFrontend(
      'warn',
      `[ai-memory-store] Re-embed error for owner ${progress.ownerKey}: ${progress.error ?? 'unknown'}`
    )
    setReembedStatus(progress.ownerKey, IDLE_REEMBED_STATUS)
  },
  done: (progress) => {
    resetTimers[progress.ownerKey] = setTimeout(() => {
      delete resetTimers[progress.ownerKey]
      setReembedStatus(progress.ownerKey, IDLE_REEMBED_STATUS)
    }, REEMBED_STATUS_RESET_DELAY_MS)
  },
}

function initEventListeners(): void {
  if (!hasTauriApis()) return

  listen<MemoryReembedProgress>('ai-memory-reembed-progress', (event) => {
    const progress = event.payload
    cancelResetTimer(progress.ownerKey)
    REEMBED_PHASE_HANDLERS[progress.phase](progress)
  }).catch((error: unknown) => {
    logFrontend(
      'warn',
      `[ai-memory-store] Listening for re-embed progress failed: ${String(error)}`
    )
  })
}

function initModelChangeSubscription(): void {
  let previousModel: string | null =
    useSettingsStore.getState().settings?.['ai.embeddingModel'] ?? null

  unsubscribeModelChange = useSettingsStore.subscribe((state) => {
    const currentModel = state.settings?.['ai.embeddingModel'] ?? null

    if (currentModel === previousModel) return

    const oldModel = previousModel
    previousModel = currentModel

    if (!currentModel) return
    if (oldModel === null) return

    void (async () => {
      try {
        await reembedAllMemories()
      } catch (error) {
        logFrontend('error', `[ai-memory-store] Re-embed failed: ${error}`)
      }
    })()
  })
}
