/**
 * IPC mock infrastructure for Vitest tests.
 *
 * Usage:
 *   import { ipc, expectToast } from './ipc-mock'
 *
 *   // Per-test command override:
 *   ipc.override('list_connections', () => [{ id: 'conn-1', ... }])
 *
 *   // Assert a toast was shown:
 *   expectToast('error', 'Connection failed')
 *
 *   // Emit a Tauri event to real listeners (requires shouldMockEvents:true):
 *   await ipc.emit('ai-stream-chunk', { streamId: 'x', content: 'hello', kind: 'content' })
 *
 * Call `setupIpc()` at module scope in setup.ts — it registers beforeEach/afterEach hooks.
 */

import { afterEach, beforeEach, expect, vi } from 'vitest'
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { emit } from '@tauri-apps/api/event'
import type { InvokeArgs } from '@tauri-apps/api/core'

import { _clearAllCaches } from '../components/query-editor/schema-metadata-cache'
import { _clearAllRoutineCaches } from '../components/query-editor/routine-parameter-cache'
import { _clearPendingBootstraps } from '../lib/schema-cache-bootstrap'
import { useToastStore } from '../stores/toast-store'
import { IPC_FIXTURES, type IpcHandler } from './fixtures'

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

/** Per-test command overrides — take precedence over IPC_FIXTURES. */
const _overrides = new Map<string, IpcHandler>()

/** Recorded call payloads per command, captured at call time. */
const _calls = new Map<string, unknown[]>()

// ---------------------------------------------------------------------------
// IPC singleton
// ---------------------------------------------------------------------------

export const ipc = {
  /**
   * Register a per-test override for a specific IPC command.
   * The handler will receive the raw args and should return the mock response.
   * Overrides are cleared automatically after each test via afterEach.
   */
  override(commandName: string, handlerFn: IpcHandler): void {
    _overrides.set(commandName, handlerFn)
  },

  /**
   * Returns the array of recorded call payloads for the given command.
   * Each entry is a deep-cloned snapshot of the args at call time.
   */
  calls(commandName: string): unknown[] {
    return _calls.get(commandName) ?? []
  },

  /**
   * Emit a Tauri event to all registered listeners.
   * Requires `shouldMockEvents: true` (set in setupIpc) so that `listen` from
   * `@tauri-apps/api/event` is intercepted by the mock layer.
   *
   * Returns the promise from `emit` so callers can await delivery.
   */
  emit<T = unknown>(eventName: string, payload?: T): Promise<void> {
    return emit(eventName, payload)
  },

  /**
   * Clear all overrides and call records. Called automatically by afterEach.
   */
  reset(): void {
    _overrides.clear()
    _calls.clear()
  },
} as const

// ---------------------------------------------------------------------------
// Toast assertion helper
// ---------------------------------------------------------------------------

/**
 * Assert that a toast with the given variant was shown and its title or message
 * contains the provided substring.
 *
 * @param type - The toast variant: 'success' | 'error' | 'warning'
 * @param messageSubstring - Substring to search for in the toast title or message
 */
export function expectToast(type: 'success' | 'error' | 'warning', messageSubstring: string): void {
  const toasts = useToastStore.getState().toasts
  const matched = toasts.some(
    (t) =>
      t.variant === type &&
      (t.title.includes(messageSubstring) || (t.message?.includes(messageSubstring) ?? false))
  )
  expect(matched).toBe(true)
}

// ---------------------------------------------------------------------------
// Setup function — call at module scope in setup.ts
// ---------------------------------------------------------------------------

/**
 * Registers beforeEach and afterEach hooks to set up and tear down the IPC mock.
 *
 * - beforeEach: installs mockIPC with { shouldMockEvents: true } and dispatches:
 *     1. Per-test overrides registered via ipc.override()
 *     2. Default fixtures from IPC_FIXTURES
 *     3. Throws `[vitest] Unmocked Tauri IPC command: <cmd>` if not found
 *
 * - afterEach: calls ipc.reset(), clears schema/routine caches, and calls clearMocks().
 */
export function setupIpc(): void {
  beforeEach(() => {
    mockIPC(
      (cmd: string, payload?: InvokeArgs) => {
        // Normalize payload: IPC commands use Record<string, unknown> shape;
        // binary payloads (number[], ArrayBuffer, Uint8Array) are left as-is
        const args =
          payload !== null &&
          typeof payload === 'object' &&
          !Array.isArray(payload) &&
          !(payload instanceof ArrayBuffer) &&
          !(payload instanceof Uint8Array)
            ? (payload as Record<string, unknown>)
            : undefined

        // Record the call (deep-clone args to capture state at call time)
        const prev = _calls.get(cmd) ?? []
        prev.push(args !== undefined ? JSON.parse(JSON.stringify(args)) : undefined)
        _calls.set(cmd, prev)

        // 1. Per-test override takes priority
        const override = _overrides.get(cmd)
        if (override) {
          return override(args)
        }

        // 2. Default fixture response
        const fixture = IPC_FIXTURES[cmd]
        if (fixture) {
          return fixture(args)
        }

        // 3. Unknown command — fail loudly so tests never silently pass on missing mocks
        throw new Error(`[vitest] Unmocked Tauri IPC command: ${cmd}`)
      },
      { shouldMockEvents: true }
    )
  })

  afterEach(() => {
    // Clear per-test state
    ipc.reset()

    // Clear module-level caches so they don't leak between tests
    _clearAllCaches()
    _clearAllRoutineCaches()
    _clearPendingBootstraps()

    // Clear Tauri IPC mock state (window.__TAURI_INTERNALS__ etc.)
    clearMocks()

    // Reset all vi.fn() mocks
    vi.clearAllMocks()
  })
}
