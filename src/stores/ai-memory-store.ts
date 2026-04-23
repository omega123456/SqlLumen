import { create } from 'zustand'
import { listen } from '@tauri-apps/api/event'
import type { MemoryReembedProgress } from '../lib/ai-memory-commands'
import { reembedMemories } from '../lib/ai-memory-commands'
import { hasTauriApis } from '../lib/tauri-env'
import { useSettingsStore } from './settings-store'
import { useConnectionStore } from './connection-store'
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
  reembedStatus: Record<string, ReembedStatus>
  setReembedStatus: (connectionId: string, status: ReembedStatus) => void
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useAiMemoryStore = create<AiMemoryState>()((set) => ({
  reembedStatus: {},

  setReembedStatus: (connectionId, status) => {
    set((s) => ({
      reembedStatus: {
        ...s.reembedStatus,
        [connectionId]: status,
      },
    }))
  },
}))

// ---------------------------------------------------------------------------
// Event listeners & settings subscription
// ---------------------------------------------------------------------------

let initialized = false

/** Reset module state — test-only. */
export function _resetAiMemoryStoreForTest(): void {
  initialized = false
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

function cancelResetTimer(connectionId: string): void {
  if (resetTimers[connectionId]) {
    clearTimeout(resetTimers[connectionId])
    delete resetTimers[connectionId]
  }
}

function initEventListeners(): void {
  if (!hasTauriApis()) return

  listen<MemoryReembedProgress>('ai-memory-reembed-progress', (event) => {
    const { connectionId, phase, done, total } = event.payload

    if (phase === 'embedding') {
      cancelResetTimer(connectionId)
      useAiMemoryStore.setState((s) => ({
        reembedStatus: {
          ...s.reembedStatus,
          [connectionId]: { status: 'running', done, total },
        },
      }))
    } else if (phase === 'error') {
      cancelResetTimer(connectionId)
      logFrontend(
        'warn',
        `[ai-memory-store] Re-embed error for connection ${connectionId}: ${event.payload.error ?? 'unknown'}`
      )
      useAiMemoryStore.setState((s) => ({
        reembedStatus: {
          ...s.reembedStatus,
          [connectionId]: { status: 'idle', done: 0, total: 0 },
        },
      }))
    } else if (phase === 'done') {
      cancelResetTimer(connectionId)
      resetTimers[connectionId] = setTimeout(() => {
        delete resetTimers[connectionId]
        useAiMemoryStore.setState((s) => ({
          reembedStatus: {
            ...s.reembedStatus,
            [connectionId]: { status: 'idle', done: 0, total: 0 },
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

  useSettingsStore.subscribe((state) => {
    const currentModel = state.settings?.['ai.embeddingModel'] ?? null

    if (currentModel === prevModel) return

    const oldModel = prevModel
    prevModel = currentModel

    // Only trigger re-embed when both old and new models are known non-null values
    if (!currentModel || oldModel === null) return

    // Fire-and-forget re-embedding for all saved connections.
    // The backend handles the empty-memories case (returns done 0/0 immediately).
    void (async () => {
      let profiles = useConnectionStore.getState().savedConnections
      if (profiles.length === 0) {
        await useConnectionStore.getState().fetchSavedConnections()
        profiles = useConnectionStore.getState().savedConnections
      }
      for (const profile of profiles) {
        try {
          await reembedMemories({ connectionId: profile.id })
        } catch (err) {
          logFrontend('error', `[ai-memory-store] Re-embed failed for ${profile.id}: ${err}`)
        }
      }
    })()
  })
}
