import { logFrontend } from '../../lib/app-log-commands'
import { hasTauriApis, hasWindow } from '../../lib/tauri-env'
import { MILLISECONDS_PER_DAY, MILLISECONDS_PER_SECOND, TWO_DIGIT_WIDTH } from '../../lib/units'
import { type SnapshotTrigger } from '../../lib/session-snapshot-commands'
import { getSetting, setSetting } from '../../lib/tauri-commands'
import { registerPreCloseHook, useSessionRestoreStore } from '../session-restore-store'
import { toErrorMessage } from '../../lib/error-message'
import { useSnapshotStore } from '../snapshot-store'
import type { SnapshotFrequency } from '../snapshot-store'

const LAST_PERIODIC_AT_KEY = 'snapshots.lastPeriodicAt'

const SUNDAY_UTC_DAY = 0

const ISO_SUNDAY_WEEKDAY = 7

const ISO_THURSDAY_WEEKDAY = 4

const DAYS_PER_WEEK = 7

export const SNAPSHOT_CHECK_INTERVAL_MS = 60_000

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

function isSameUtcDay(left: Date, right: Date): boolean {
  return (
    left.getUTCFullYear() === right.getUTCFullYear() &&
    left.getUTCMonth() === right.getUTCMonth() &&
    left.getUTCDate() === right.getUTCDate()
  )
}

function isoWeekKey(date: Date): string {
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const utcDay = thursday.getUTCDay()
  const isoWeekday = utcDay === SUNDAY_UTC_DAY ? ISO_SUNDAY_WEEKDAY : utcDay
  thursday.setUTCDate(thursday.getUTCDate() + ISO_THURSDAY_WEEKDAY - isoWeekday)
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1))
  const dayOfYear = (thursday.getTime() - yearStart.getTime()) / MILLISECONDS_PER_DAY + 1
  const weekNumber = Math.ceil(dayOfYear / DAYS_PER_WEEK)
  return `${thursday.getUTCFullYear()}-${String(weekNumber).padStart(TWO_DIGIT_WIDTH, '0')}`
}

function parseEpochSeconds(marker: string | null): Date | null {
  if (!marker) {
    return null
  }

  const seconds = Number.parseInt(marker, 10)
  if (!Number.isFinite(seconds)) {
    return null
  }

  const date = new Date(seconds * MILLISECONDS_PER_SECOND)
  return Number.isNaN(date.getTime()) ? null : date
}

function toEpochSeconds(date: Date): string {
  return String(Math.floor(date.getTime() / MILLISECONDS_PER_SECOND))
}

interface PeriodicCheckMoment {
  frequency: 'daily' | 'weekly'
  lastDate: Date
  now: Date
}

function isNewPeriod({ frequency, lastDate, now }: PeriodicCheckMoment): boolean {
  if (frequency === 'daily') {
    return !isSameUtcDay(lastDate, now)
  }
  return isoWeekKey(lastDate) !== isoWeekKey(now)
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
