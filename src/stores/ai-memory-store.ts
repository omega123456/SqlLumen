import { create } from 'zustand'
import { listen } from '@tauri-apps/api/event'
import type { MemoryReembedProgress } from '../lib/ai-memory-commands'
import { reembedAllMemories } from '../lib/ai-memory-commands'
import { hasTauriApis } from '../lib/tauri-env'
import { useSettingsStore } from './settings-store'

import { logFrontend } from '../lib/app-log-commands'
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReembedStatus {
  status: 'idle' | 'running'
  done: number
  total: number
}

interface AiMemoryState {
  /**
   * Re-embed status keyed by a generic owner key emitted in progress events
   * (`global`, `group_{id}`, or a connection id).
   */
  reembedStatus: Record<string, ReembedStatus>
  setReembedStatus: (ownerKey: string, status: ReembedStatus) => void
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useAiMemoryStore = create<AiMemoryState>()((set) => ({
  reembedStatus: {},

  setReembedStatus: (ownerKey, status) => {
    set((s) => ({
      reembedStatus: {
        ...s.reembedStatus,
        [ownerKey]: status,
      },
    }))
  },
}))

// ---------------------------------------------------------------------------
// Event listeners & settings subscription
// ---------------------------------------------------------------------------

let initialized = false
let unsubscribeModelChange: (() => void) | null = null

/** Reset module state — test-only. */
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

/** Bootstrap event listeners and the embedding-model-change subscription.
 *  Call once at app startup (from `main.tsx`). */
export function initAiMemoryStore(): void {
  if (initialized) return
  initialized = true

  initEventListeners()
  initModelChangeSubscription()
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const resetTimers: Record<string, ReturnType<typeof setTimeout>> = {}

function cancelResetTimer(ownerKey: string): void {
  if (resetTimers[ownerKey]) {
    clearTimeout(resetTimers[ownerKey])
    delete resetTimers[ownerKey]
  }
}

function initEventListeners(): void {
  if (!hasTauriApis()) return

  listen<MemoryReembedProgress>('ai-memory-reembed-progress', (event) => {
    const { ownerKey, phase, done, total } = event.payload

    if (phase === 'embedding') {
      cancelResetTimer(ownerKey)
      useAiMemoryStore.setState((s) => ({
        reembedStatus: {
          ...s.reembedStatus,
          [ownerKey]: { status: 'running', done, total },
        },
      }))
    } else if (phase === 'error') {
      cancelResetTimer(ownerKey)
      logFrontend(
        'warn',
        `[ai-memory-store] Re-embed error for owner ${ownerKey}: ${event.payload.error ?? 'unknown'}`
      )
      useAiMemoryStore.setState((s) => ({
        reembedStatus: {
          ...s.reembedStatus,
          [ownerKey]: { status: 'idle', done: 0, total: 0 },
        },
      }))
    } else if (phase === 'done') {
      cancelResetTimer(ownerKey)
      resetTimers[ownerKey] = setTimeout(() => {
        delete resetTimers[ownerKey]
        useAiMemoryStore.setState((s) => ({
          reembedStatus: {
            ...s.reembedStatus,
            [ownerKey]: { status: 'idle', done: 0, total: 0 },
          },
        }))
      }, 2000)
    }
  }).catch(() => {
    // listen not available — non-critical
  })
}

function initModelChangeSubscription(): void {
  // Seed prevModel from current state so the first subscription fire (hydration)
  // is correctly detected as "no change" rather than hitting a null guard.
  let prevModel: string | null = useSettingsStore.getState().settings?.['ai.embeddingModel'] ?? null

  unsubscribeModelChange = useSettingsStore.subscribe((state) => {
    const currentModel = state.settings?.['ai.embeddingModel'] ?? null

    if (currentModel === prevModel) return

    const oldModel = prevModel
    prevModel = currentModel

    // Only trigger re-embed when both old and new models are known non-null values
    if (!currentModel || oldModel === null) return

    // Fire-and-forget re-embedding across all levels (global, every group, every
    // connection). The backend orchestrates the fan-out and emits per-owner
    // progress events; the empty-memories case resolves immediately.
    void (async () => {
      try {
        await reembedAllMemories()
      } catch (err) {
        logFrontend('error', `[ai-memory-store] Re-embed failed: ${err}`)
      }
    })()
  })
}
