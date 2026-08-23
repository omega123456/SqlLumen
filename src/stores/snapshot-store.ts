/**
 * Snapshot store — owns the Session Snapshots dialog state, the snapshot list,
 * selection, and the create / restore / delete orchestration. It also owns the
 * periodic scheduler and the on-close hook.
 *
 * Reuses the existing session-restore engine for building and applying
 * `SessionState` (no second restore implementation). This store imports
 * `session-restore-store`, `connection-store`, and `settings-store`; it must
 * NEVER be imported by `session-restore-store` (avoids an import cycle).
 */

import { create } from 'zustand'

import { logFrontend } from '../lib/app-log-commands'
import { hasTauriApis } from '../lib/tauri-env'
import { showErrorToast } from './toast-store'
import {
  createSessionSnapshot,
  deleteSessionSnapshot,
  getSessionSnapshot,
  listSessionSnapshots,
  type SnapshotConnectionSummary,
  type SnapshotSummary,
  type SnapshotTrigger,
} from '../lib/session-snapshot-commands'
import type { SessionConnectionState, SessionState } from '../lib/session-restore-commands'
import { getSetting, setSetting } from '../lib/tauri-commands'
import {
  buildSessionState,
  registerPreCloseHook,
  useSessionRestoreStore,
} from './session-restore-store'
import { normalizeActiveConnectionOrder, useConnectionStore } from './connection-store'
import { useWorkspaceStore } from './workspace-store'
import { useSettingsStore } from './settings-store'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hidden settings marker (not in SETTINGS_DEFAULTS) recording the last periodic snapshot time. */
const LAST_PERIODIC_AT_KEY = 'snapshots.lastPeriodicAt'

/** Scheduler tick interval (1 minute). */
export const SNAPSHOT_CHECK_INTERVAL_MS = 60_000

/** Tab types serialized into a `SessionState` (must match `serializeTab` in session-restore-store). */
const SERIALIZABLE_TAB_TYPES: ReadonlySet<string> = new Set([
  'query-editor',
  'table-data',
  'schema-info',
  'history',
])

type SnapshotFrequency = 'off' | 'onClose' | 'daily' | 'weekly'

// ---------------------------------------------------------------------------
// Summary computation
// ---------------------------------------------------------------------------

interface SnapshotMetadata {
  connectionCount: number
  tabCount: number
  summary: SnapshotConnectionSummary[]
}

/**
 * Compute the denormalized display summary (per-connection name + serializable
 * tab count) from the live connection/workspace stores. Counts only tab types
 * that `buildSessionState` serializes, keeping the summary consistent with the
 * stored `state_json`.
 */
function computeSnapshotMetadata(): SnapshotMetadata {
  const connectionStore = useConnectionStore.getState()
  const workspaceStore = useWorkspaceStore.getState()

  const orderedConnectionIds = normalizeActiveConnectionOrder(
    connectionStore.activeConnectionOrder,
    connectionStore.activeConnections
  )

  const summary: SnapshotConnectionSummary[] = []
  let tabCount = 0

  for (const sessionId of orderedConnectionIds) {
    const active = connectionStore.activeConnections[sessionId]
    if (!active) {
      continue
    }
    const tabs = workspaceStore.tabsByConnection[sessionId] ?? []
    const connectionTabCount = tabs.filter((tab) => SERIALIZABLE_TAB_TYPES.has(tab.type)).length
    tabCount += connectionTabCount
    summary.push({ name: active.profile.name, tabCount: connectionTabCount })
  }

  return {
    connectionCount: summary.length,
    tabCount,
    summary,
  }
}

// ---------------------------------------------------------------------------
// Periodic boundary helpers
// ---------------------------------------------------------------------------

/** True when both dates fall on the same UTC calendar day. */
function isSameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  )
}

/** ISO-8601 week key (`YYYY-WW`) for a date, computed in UTC. */
function isoWeekKey(date: Date): string {
  // Copy and shift to the Thursday of the current ISO week.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dayNum = d.getUTCDay() === 0 ? 7 : d.getUTCDay()
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return `${d.getUTCFullYear()}-${String(weekNo).padStart(2, '0')}`
}

/** Planned storage format for `snapshots.lastPeriodicAt`: Unix epoch seconds as a decimal string. */
function parseEpochSeconds(marker: string | null): Date | null {
  if (!marker) {
    return null
  }

  const seconds = Number.parseInt(marker, 10)
  if (!Number.isFinite(seconds)) {
    return null
  }

  const date = new Date(seconds * 1000)
  return Number.isNaN(date.getTime()) ? null : date
}

function toEpochSeconds(date: Date): string {
  return String(Math.floor(date.getTime() / 1000))
}

function buildRecoveryState(
  beforeRestoreState: SessionState,
  targetedConnectionIds: string[],
  closedConnectionIds: string[]
): SessionState | null {
  if (closedConnectionIds.length === 0) {
    return null
  }

  const closedIdSet = new Set(closedConnectionIds)
  const recoveryConnections: SessionConnectionState[] = []
  const savedIndexToRecoveryIndex = new Map<number, number>()

  targetedConnectionIds.forEach((sessionId, savedIndex) => {
    if (!closedIdSet.has(sessionId)) {
      return
    }

    const connectionState = beforeRestoreState.connections[savedIndex]
    if (!connectionState) {
      return
    }

    savedIndexToRecoveryIndex.set(savedIndex, recoveryConnections.length)
    recoveryConnections.push(connectionState)
  })

  if (recoveryConnections.length === 0) {
    return null
  }

  const recoveryState: SessionState = {
    version: beforeRestoreState.version,
    connections: recoveryConnections,
  }

  if (typeof beforeRestoreState.activeConnectionIndex === 'number') {
    const recoveryActiveIndex = savedIndexToRecoveryIndex.get(
      beforeRestoreState.activeConnectionIndex
    )
    if (typeof recoveryActiveIndex === 'number') {
      recoveryState.activeConnectionIndex = recoveryActiveIndex
    }
  }

  return recoveryState
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface SnapshotState {
  snapshots: SnapshotSummary[]
  isDialogOpen: boolean
  isLoading: boolean
  selectedSnapshotId: number | null
  isBusy: boolean
  isRestoring: boolean

  // Actions
  openDialog: () => Promise<void>
  closeDialog: () => void
  loadSnapshots: () => Promise<void>
  selectSnapshot: (id: number | null) => void
  createManualSnapshot: () => Promise<void>
  createAutoSnapshot: (trigger: SnapshotTrigger) => Promise<number | null>
  deleteSnapshot: (id: number) => Promise<void>
  restoreSnapshot: (id: number) => Promise<void>
  runPeriodicCheck: () => Promise<void>
  handleAppClose: () => Promise<void>
  getFrequency: () => SnapshotFrequency
  getKeep: () => number
}

export const useSnapshotStore = create<SnapshotState>()((set, get) => ({
  snapshots: [],
  isDialogOpen: false,
  isLoading: false,
  selectedSnapshotId: null,
  isBusy: false,
  isRestoring: false,

  getFrequency: (): SnapshotFrequency => {
    const value = useSettingsStore.getState().getSetting('snapshots.frequency')
    if (value === 'off' || value === 'onClose' || value === 'daily' || value === 'weekly') {
      return value
    }
    return 'daily'
  },

  getKeep: (): number => {
    const value = useSettingsStore.getState().getSetting('snapshots.keep')
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 10
  },

  openDialog: async (): Promise<void> => {
    set({ isDialogOpen: true })
    await get().loadSnapshots()
  },

  closeDialog: (): void => {
    set({ isDialogOpen: false, selectedSnapshotId: null })
  },

  loadSnapshots: async (): Promise<void> => {
    set({ isLoading: true })
    try {
      const snapshots = await listSessionSnapshots()
      set({ snapshots })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      showErrorToast('Failed to load snapshots', msg)
    } finally {
      set({ isLoading: false })
    }
  },

  selectSnapshot: (id: number | null): void => {
    set({ selectedSnapshotId: id })
  },

  createManualSnapshot: async (): Promise<void> => {
    set({ isBusy: true })
    try {
      const metadata = computeSnapshotMetadata()
      const stateJson = JSON.stringify(buildSessionState())
      await createSessionSnapshot({
        triggerType: 'manual',
        connectionCount: metadata.connectionCount,
        tabCount: metadata.tabCount,
        summaryJson: JSON.stringify(metadata.summary),
        stateJson,
        keep: get().getKeep(),
      })
      await get().loadSnapshots()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      showErrorToast('Failed to create snapshot', msg)
    } finally {
      set({ isBusy: false })
    }
  },

  createAutoSnapshot: async (trigger: SnapshotTrigger): Promise<number | null> => {
    // `beforeRestore` is part of an explicit, user-initiated restore and always
    // proceeds. All other automatic triggers are suppressed when frequency=off.
    if (trigger !== 'beforeRestore' && get().getFrequency() === 'off') {
      return null
    }
    if (
      trigger !== 'beforeRestore' &&
      trigger !== 'manual' &&
      !useSessionRestoreStore.getState().canPersistSession()
    ) {
      return null
    }

    set({ isBusy: true })
    try {
      const metadata = computeSnapshotMetadata()
      const stateJson = JSON.stringify(buildSessionState())
      const id = await createSessionSnapshot({
        triggerType: trigger,
        connectionCount: metadata.connectionCount,
        tabCount: metadata.tabCount,
        summaryJson: JSON.stringify(metadata.summary),
        stateJson,
        keep: get().getKeep(),
      })
      return id
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logFrontend('error', `[snapshot] Failed to create ${trigger} snapshot: ${msg}`)
      return null
    } finally {
      set({ isBusy: false })
    }
  },

  deleteSnapshot: async (id: number): Promise<void> => {
    set({ isBusy: true })
    try {
      await deleteSessionSnapshot(id)
      await get().loadSnapshots()
      if (get().selectedSnapshotId === id) {
        set({ selectedSnapshotId: null })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      showErrorToast('Failed to delete snapshot', msg)
    } finally {
      set({ isBusy: false })
    }
  },

  restoreSnapshot: async (id: number): Promise<void> => {
    // Re-entrancy guard: a restore already in progress must not be triggered
    // again (the nested beforeRestore snapshot resets `isBusy`, so we cannot
    // rely on that flag to block repeat clicks).
    if (get().isRestoring) {
      return
    }
    set({ isBusy: true, isRestoring: true })
    try {
      const sessionRestoreStore = useSessionRestoreStore.getState()
      if (sessionRestoreStore.isRestoring) {
        const message = 'Session restore is already in progress. Please wait and try again.'
        logFrontend(
          'warn',
          `[snapshot] Restore blocked while session restore is already in progress.`
        )
        showErrorToast('Restore failed', message)
        return
      }

      // 1. Load the target snapshot's full state into memory FIRST so retention
      //    pruning (from the beforeRestore create below) can never delete the
      //    snapshot being restored (NFR2).
      const stateJson = await getSessionSnapshot(id)
      if (!stateJson) {
        showErrorToast('Restore failed', 'This snapshot could not be found.')
        return
      }

      // 2. Parse the state.
      let parsedState: SessionState
      try {
        parsedState = JSON.parse(stateJson) as SessionState
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        logFrontend('error', `[snapshot] Failed to parse snapshot ${id} state: ${msg}`)
        showErrorToast('Restore failed', 'This snapshot is corrupted and cannot be restored.')
        return
      }

      // 3. Save the current session as a safety snapshot when there is anything
      //    to lose (at least one active connection).
      const connectionStore = useConnectionStore.getState()
      const beforeRestoreConnectionIds = normalizeActiveConnectionOrder(
        connectionStore.activeConnectionOrder,
        connectionStore.activeConnections
      )
      const hasActiveConnections = beforeRestoreConnectionIds.length > 0
      const beforeRestoreState = hasActiveConnections ? buildSessionState() : null
      if (hasActiveConnections) {
        const beforeRestoreSnapshotId = await get().createAutoSnapshot('beforeRestore')
        if (beforeRestoreSnapshotId == null) {
          showErrorToast(
            'Restore failed',
            'Could not create the safety snapshot. The current session was left unchanged.'
          )
          return
        }
      }

      // 4. Force-close everything in active-order (no unsaved-changes prompts).
      //    Stop on the first failure so recovery can replay a deterministic
      //    subset of the pre-restore session without creating duplicates.
      const closedConnectionIds: string[] = []
      let closeFailureId: string | null = null

      for (const sessionId of beforeRestoreConnectionIds) {
        const closed = await useConnectionStore
          .getState()
          .closeConnection(sessionId, { force: true })
        if (!closed) {
          closeFailureId = sessionId
          break
        }
        closedConnectionIds.push(sessionId)
      }

      const remainingConnections = useConnectionStore.getState().activeConnections
      const stillOpenTargetIds = beforeRestoreConnectionIds.filter(
        (sessionId) => sessionId in remainingConnections
      )
      if (closeFailureId || stillOpenTargetIds.length > 0) {
        if (beforeRestoreState) {
          const recoveryState = buildRecoveryState(
            beforeRestoreState,
            beforeRestoreConnectionIds,
            closedConnectionIds.filter((sessionId) => !(sessionId in remainingConnections))
          )
          if (recoveryState) {
            await useSessionRestoreStore.getState().restoreFromState(recoveryState)
          }
        }

        const detail =
          closeFailureId != null
            ? ` Failed while force-closing ${closeFailureId}.`
            : stillOpenTargetIds.length > 0
              ? ` Remaining open connections: ${stillOpenTargetIds.join(', ')}.`
              : ''
        logFrontend(
          'error',
          `[snapshot] Restore aborted because not all connections closed before restore.${detail}`
        )
        showErrorToast(
          'Restore failed',
          'Could not close all open connections. The current session was restored.'
        )
        return
      }

      // 5. Apply the restored state via the shared restore engine.
      await useSessionRestoreStore.getState().restoreFromState(parsedState)

      // 6. Close the dialog on success.
      get().closeDialog()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logFrontend('error', `[snapshot] Failed to restore snapshot ${id}: ${msg}`)
      showErrorToast('Restore failed', msg)
    } finally {
      set({ isBusy: false, isRestoring: false })
    }
  },

  runPeriodicCheck: async (): Promise<void> => {
    const frequency = get().getFrequency()
    if (frequency !== 'daily' && frequency !== 'weekly') {
      return
    }

    try {
      const now = new Date()
      const marker = await getSetting(LAST_PERIODIC_AT_KEY)
      const lastDate = parseEpochSeconds(marker)
      const hasValidMarker = lastDate != null && !Number.isNaN(lastDate.getTime())

      let due: boolean
      if (frequency === 'daily') {
        due = !hasValidMarker || !isSameUtcDay(lastDate, now)
      } else {
        due = !hasValidMarker || isoWeekKey(lastDate) !== isoWeekKey(now)
      }

      if (!due) {
        return
      }

      const id = await get().createAutoSnapshot(frequency)
      if (id != null) {
        await setSetting(LAST_PERIODIC_AT_KEY, toEpochSeconds(now))
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logFrontend('error', `[snapshot] Periodic check failed: ${msg}`)
    }
  },

  handleAppClose: async (): Promise<void> => {
    if (get().getFrequency() === 'off') {
      return
    }
    await get().createAutoSnapshot('onClose')
  },
}))

// ---------------------------------------------------------------------------
// Scheduler registration
// ---------------------------------------------------------------------------

let schedulerRegistered = false
let periodicIntervalId: number | null = null

/**
 * Register the periodic scheduler (a `setInterval` running `runPeriodicCheck`)
 * and the on-close hook. Idempotent: guarded against double-registration.
 */
export function registerSnapshotScheduler(): void {
  if (schedulerRegistered || typeof window === 'undefined' || !hasTauriApis()) {
    return
  }
  schedulerRegistered = true

  periodicIntervalId = window.setInterval(() => {
    void useSnapshotStore.getState().runPeriodicCheck()
  }, SNAPSHOT_CHECK_INTERVAL_MS)

  registerPreCloseHook(() => useSnapshotStore.getState().handleAppClose())
}

/** Test-only: clear the interval and reset the double-registration guard. */
export function _resetSnapshotSchedulerForTests(): void {
  if (periodicIntervalId != null && typeof window !== 'undefined') {
    window.clearInterval(periodicIntervalId)
  }
  periodicIntervalId = null
  schedulerRegistered = false
}
