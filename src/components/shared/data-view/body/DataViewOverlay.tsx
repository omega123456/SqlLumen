import type { ComponentPropsWithoutRef } from 'react'
import type { DataViewTestIds } from '../data-view-source'
import type { DataViewActivity } from './data-view-body-model'

type BusyActivity = Exclude<DataViewActivity, 'idle'>

const ACTIVITY_LABELS: Record<BusyActivity, string> = {
  restoring: 'Restoring cached results…',
  sorting: 'Sorting…',
  loading: 'Loading…',
}

export function DataViewSpinner(attributes: ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      className="size-6 animate-spin-800ms rounded-round border-2 border-transparent border-t-light-primary window-blurred:animate-spin-800ms-paused dark:border-t-dark-primary"
      {...attributes}
    />
  )
}

function overlayTestIdFor(activity: BusyActivity, testIds: DataViewTestIds): string {
  if (activity === 'restoring') return testIds.restoreOverlay
  return testIds.busyOverlay
}

interface DataViewOverlayProps {
  activity: DataViewActivity
  testIds: DataViewTestIds
}

export function DataViewOverlay({ activity, testIds }: DataViewOverlayProps) {
  if (activity === 'idle') return null
  return (
    <div
      className="absolute inset-x-0 top-command-bar bottom-0 z-10 flex flex-col items-center justify-center gap-2 bg-light-surface-container-lowest text-size-row text-light-on-surface-variant opacity-85 dark:bg-dark-surface-container-lowest dark:text-dark-on-surface-variant"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid={overlayTestIdFor(activity, testIds)}
    >
      <DataViewSpinner aria-hidden="true" />
      <span>{ACTIVITY_LABELS[activity]}</span>
    </div>
  )
}
