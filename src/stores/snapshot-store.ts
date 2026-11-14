import { create } from 'zustand'
import { logFrontend } from '../lib/app-log-commands'
import { isPositiveFiniteNumber } from '../lib/value-checks'
import { showErrorToast } from './toast-store'
import {
  createSessionSnapshot,
  deleteSessionSnapshot,
  listSessionSnapshots,
  type SnapshotSummary,
  type SnapshotTrigger,
} from '../lib/session-snapshot-commands'
import { buildSessionState } from './session-restore-store'
import { useSettingsStore } from './settings-store'
import { toErrorMessage } from '../lib/error-message'
import { computeSnapshotMetadata } from './snapshot-store/snapshot-metadata'
import { restoreSnapshot } from './snapshot-store/snapshot-restore'
import {
  isAutoSnapshotSuppressed,
  isSnapshotFrequency,
  runPeriodicCheck,
} from './snapshot-store/snapshot-schedule'
export {
  SNAPSHOT_CHECK_INTERVAL_MS,
  registerSnapshotScheduler,
  _resetSnapshotSchedulerForTests,
} from './snapshot-store/snapshot-schedule'

const DEFAULT_SNAPSHOTS_TO_KEEP = 10

export type SnapshotFrequency = 'off' | 'onClose' | 'daily' | 'weekly'

interface SnapshotState {
  snapshots: SnapshotSummary[]
  isDialogOpen: boolean
  isLoading: boolean
  selectedSnapshotId: number | null
  isBusy: boolean
  isRestoring: boolean

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

function getFrequency(): SnapshotFrequency {
  const value = useSettingsStore.getState().getSetting('snapshots.frequency')
  if (isSnapshotFrequency(value)) {
    return value
  }
  return 'daily'
}

function getKeep(): number {
  const value = useSettingsStore.getState().getSetting('snapshots.keep')
  const parsed = Number.parseInt(value, 10)
  return isPositiveFiniteNumber(parsed) ? parsed : DEFAULT_SNAPSHOTS_TO_KEEP
}

async function openDialog(): Promise<void> {
  useSnapshotStore.setState({ isDialogOpen: true })
  await useSnapshotStore.getState().loadSnapshots()
}

function closeDialog(): void {
  useSnapshotStore.setState({ isDialogOpen: false, selectedSnapshotId: null })
}

async function loadSnapshots(): Promise<void> {
  useSnapshotStore.setState({ isLoading: true })
  try {
    const snapshots = await listSessionSnapshots()
    useSnapshotStore.setState({ snapshots })
  } catch (error) {
    const message = toErrorMessage(error)
    showErrorToast('Failed to load snapshots', message)
  } finally {
    useSnapshotStore.setState({ isLoading: false })
  }
}

function selectSnapshot(id: number | null): void {
  useSnapshotStore.setState({ selectedSnapshotId: id })
}

async function createManualSnapshot(): Promise<void> {
  useSnapshotStore.setState({ isBusy: true })
  try {
    const metadata = computeSnapshotMetadata()
    const stateJson = JSON.stringify(buildSessionState())
    await createSessionSnapshot({
      triggerType: 'manual',
      connectionCount: metadata.connectionCount,
      tabCount: metadata.tabCount,
      summaryJson: JSON.stringify(metadata.summary),
      stateJson: stateJson,
      keep: useSnapshotStore.getState().getKeep(),
    })
    await useSnapshotStore.getState().loadSnapshots()
  } catch (error) {
    const message = toErrorMessage(error)
    showErrorToast('Failed to create snapshot', message)
  } finally {
    useSnapshotStore.setState({ isBusy: false })
  }
}

export async function createAutoSnapshot(trigger: SnapshotTrigger): Promise<number | null> {
  if (isAutoSnapshotSuppressed(trigger, useSnapshotStore.getState().getFrequency())) {
    return null
  }

  useSnapshotStore.setState({ isBusy: true })
  try {
    const metadata = computeSnapshotMetadata()
    const stateJson = JSON.stringify(buildSessionState())
    const id = await createSessionSnapshot({
      triggerType: trigger,
      connectionCount: metadata.connectionCount,
      tabCount: metadata.tabCount,
      summaryJson: JSON.stringify(metadata.summary),
      stateJson: stateJson,
      keep: useSnapshotStore.getState().getKeep(),
    })
    return id
  } catch (error) {
    const message = toErrorMessage(error)
    logFrontend('error', `[snapshot] Failed to create ${trigger} snapshot: ${message}`)
    return null
  } finally {
    useSnapshotStore.setState({ isBusy: false })
  }
}

async function deleteSnapshot(id: number): Promise<void> {
  useSnapshotStore.setState({ isBusy: true })
  try {
    await deleteSessionSnapshot(id)
    await useSnapshotStore.getState().loadSnapshots()
    if (useSnapshotStore.getState().selectedSnapshotId === id) {
      useSnapshotStore.setState({ selectedSnapshotId: null })
    }
  } catch (error) {
    const message = toErrorMessage(error)
    showErrorToast('Failed to delete snapshot', message)
  } finally {
    useSnapshotStore.setState({ isBusy: false })
  }
}

async function handleAppClose(): Promise<void> {
  const areSnapshotsOff = useSnapshotStore.getState().getFrequency() === 'off'
  if (areSnapshotsOff) {
    return
  }
  await useSnapshotStore.getState().createAutoSnapshot('onClose')
}

export const useSnapshotStore = create<SnapshotState>()(() => ({
  snapshots: [],
  isDialogOpen: false,
  isLoading: false,
  selectedSnapshotId: null,
  isBusy: false,
  isRestoring: false,
  getFrequency: getFrequency,
  getKeep: getKeep,
  openDialog: openDialog,
  closeDialog: closeDialog,
  loadSnapshots: loadSnapshots,
  selectSnapshot: selectSnapshot,
  createManualSnapshot: createManualSnapshot,
  createAutoSnapshot: createAutoSnapshot,
  deleteSnapshot: deleteSnapshot,
  restoreSnapshot: restoreSnapshot,
  runPeriodicCheck: runPeriodicCheck,
  handleAppClose: handleAppClose,
}))
