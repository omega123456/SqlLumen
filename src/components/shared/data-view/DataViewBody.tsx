import { useEffect, type ReactNode } from 'react'
import { useDataView } from '../../../stores/data-view/use-data-view'
import { joinClassNames, SCROLLBAR } from '../../../lib/class-names'
import { DataToolbar } from './DataToolbar'
import { DataGridView } from './DataGridView'
import { DataFormView } from './DataFormView'
import { DataTextView } from './DataTextView'
import { DataViewModeSwitch } from './DataViewModeSwitch'
import type { DataViewSource } from './data-view-source'
import type { DataToolbarReadiness } from './toolbar/data-toolbar-model'
import { useDataFilter } from './toolbar/use-data-filter'
import { DataViewDialogs } from './body/DataViewDialogs'
import { DataViewOverlay } from './body/DataViewOverlay'
import {
  activityOf,
  panelClassNameFor,
  type DataViewPanelAttributes,
} from './body/data-view-body-model'

export interface DataViewSlots {
  editTarget: ReactNode
  bands: ReactNode
  exportDialog: ReactNode
}

export interface DataViewBodyProps {
  source: DataViewSource
  slots: DataViewSlots
  readiness: DataToolbarReadiness
  panelAttributes: DataViewPanelAttributes
  message?: ReactNode
}

export function DataViewMessage({ children }: { children: ReactNode }) {
  return (
    <div
      className={joinClassNames([
        'min-h-0 flex-1 overflow-y-auto border-t border-t-light-stroke-divider bg-light-surface-container-lowest p-3 dark:border-t-dark-stroke-divider dark:bg-dark-surface-container-lowest',
        SCROLLBAR,
      ])}
    >
      {children}
    </div>
  )
}

function DataViewModes({ source }: { source: DataViewSource }) {
  const mode = useDataView(source.ref, (view) => view.mode)
  const remountPerResultKey = source.ref.resultIndex
  return (
    <DataViewModeSwitch
      key={remountPerResultKey}
      mode={mode}
      grid={<DataGridView source={source} />}
      form={<DataFormView source={source} />}
      text={<DataTextView source={source} />}
    />
  )
}

function useCloseFilterWhenInactive(isActive: boolean, closeFilterDialog: () => void) {
  useEffect(() => {
    if (isActive) return
    queueMicrotask(closeFilterDialog)
  }, [isActive, closeFilterDialog])
}

export function DataViewBody({
  source,
  slots,
  readiness,
  panelAttributes,
  message = null,
}: DataViewBodyProps) {
  const filter = useDataFilter(source.ref)
  useCloseFilterWhenInactive(source.isActive, filter.closeFilterDialog)
  const mode = useDataView(source.ref, (view) => view.mode)
  const columnCount = useDataView(source.ref, (view) => view.slot.columns.length)
  const isReloading = source.capabilities.reload?.isLoading ?? false
  const activity = useDataView(source.ref, (view) => activityOf(view, isReloading))
  const content = message ?? (
    <>
      {slots.bands}
      <DataViewModes source={source} />
      <DataViewOverlay activity={activity} testIds={source.testIds} />
    </>
  )

  return (
    <>
      <div
        {...panelAttributes}
        className={panelClassNameFor(mode, columnCount)}
        aria-busy={activity === 'restoring'}
      >
        <DataToolbar
          source={source}
          editTarget={slots.editTarget}
          filter={filter}
          readiness={readiness}
        />
        {content}
      </div>
      <DataViewDialogs surfaceRef={source.ref} filter={filter} exportDialog={slots.exportDialog} />
    </>
  )
}
