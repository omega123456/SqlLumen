import {
  fromUnixTime,
  getUnixTime,
  isSameDay,
  isSameISOWeek,
  isValid,
  milliseconds,
} from 'date-fns'
import { logFrontend } from '../../lib/app-log-commands'
import { hasTauriApis, hasWindow } from '../../lib/tauri-env'
import { type SnapshotTrigger } from '../../lib/session-snapshot-commands'
import { getSetting, setSetting } from '../../lib/tauri-commands'
import { registerPreCloseHook, useSessionRestoreStore } from '../session-restore-store'
import { toErrorMessage } from '../../lib/error-message'
import { useSnapshotStore } from '../snapshot-store'
import type { SnapshotFrequency } from '../snapshot-store'

const LAST_PERIODIC_AT_KEY = 'snapshots.lastPeriodicAt'

export const SNAPSHOT_CHECK_INTERVAL_MS = milliseconds({ minutes: 1 })

const SNAPSHOT_FREQUENCIES: ReadonlySet<string> = new Set<SnapshotFrequency>([
  'off',
  'onClose',
  'daily',
  'weekly',
])

type PeriodicSnapshotFrequency = Extract<SnapshotFrequency, 'daily' | 'weekly'>

const PERIODIC_SNAPSHOT_FREQUENCIES: ReadonlySet<SnapshotFrequency> = new Set<SnapshotFrequency>([
  'daily',
  'weekly',
])

function isPeriodicFrequency(frequency: SnapshotFrequency): frequency is PeriodicSnapshotFrequency {
  return PERIODIC_SNAPSHOT_FREQUENCIES.has(frequency)
}

export function isSnapshotFrequency(value: string): value is SnapshotFrequency {
  return SNAPSHOT_FREQUENCIES.has(value)
}

export function isAutoSnapshotSuppressed(
  trigger: SnapshotTrigger,
  frequency: SnapshotFrequency
): boolean {
  if (trigger === 'beforeRestore') return false
  if (frequency === 'off') return true
  if (trigger === 'manual') return false
  return !useSessionRestoreStore.getState().canPersistSession()
}

function parseEpochSeconds(marker: string | null): Date | null {
  if (!marker) {
    return null
  }

  const seconds = Number.parseInt(marker, 10)
  if (!Number.isFinite(seconds)) {
    return null
  }

  const date = fromUnixTime(seconds)
  return isValid(date) ? date : null
}

function toEpochSeconds(date: Date): string {
  return String(getUnixTime(date))
}

interface PeriodicCheckMoment {
  frequency: 'daily' | 'weekly'
  lastDate: Date
  now: Date
}

function isNewPeriod({ frequency, lastDate, now }: PeriodicCheckMoment): boolean {
  if (frequency === 'daily') {
    return !isSameDay(lastDate, now)
  }
  return !isSameISOWeek(lastDate, now)
}

export async function runPeriodicCheck(): Promise<void> {
  const frequency = useSnapshotStore.getState().getFrequency()
  if (!isPeriodicFrequency(frequency)) {
    return
  }

  try {
    const now = new Date()
    const marker = await getSetting(LAST_PERIODIC_AT_KEY)
    const lastDate = parseEpochSeconds(marker)
    const hasValidMarker = lastDate != null && !Number.isNaN(lastDate.getTime())

    const due = !hasValidMarker || isNewPeriod({ frequency, lastDate, now })

    if (!due) {
      return
    }

    const id = await useSnapshotStore.getState().createAutoSnapshot(frequency)
    if (id != null) {
      await setSetting(LAST_PERIODIC_AT_KEY, toEpochSeconds(now))
    }
  } catch (error) {
    const message = toErrorMessage(error)
    logFrontend('error', `[snapshot] Periodic check failed: ${message}`)
  }
}

let schedulerRegistered = false

let periodicIntervalId: number | null = null

export function registerSnapshotScheduler(): void {
  if (schedulerRegistered) return
  if (!hasWindow()) return
  if (!hasTauriApis()) return
  schedulerRegistered = true

  periodicIntervalId = window.setInterval(() => {
    void useSnapshotStore.getState().runPeriodicCheck()
  }, SNAPSHOT_CHECK_INTERVAL_MS)

  registerPreCloseHook(() => useSnapshotStore.getState().handleAppClose())
}

export function _resetSnapshotSchedulerForTests(): void {
  const intervalId = periodicIntervalId
  const hasPeriodicInterval = intervalId != null && hasWindow()
  if (hasPeriodicInterval) {
    window.clearInterval(intervalId)
  }
  periodicIntervalId = null
  schedulerRegistered = false
}
