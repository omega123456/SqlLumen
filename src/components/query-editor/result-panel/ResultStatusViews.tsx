import type { ReactNode } from 'react'
import { Play, ClockCountdown } from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import { InfoBar } from '../../common/InfoBar'
import { ResultSubTabs } from '../ResultSubTabs'
import { EditModeDropdown } from '../EditModeDropdown'
import {
  DataViewBody,
  DataViewMessage,
  type DataViewSlots,
} from '../../shared/data-view/DataViewBody'
import { DataViewSpinner } from '../../shared/data-view/body/DataViewOverlay'
import type { SingleResultState } from '../../../stores/query-store'
import { ResultBands } from './ResultBands'
import { ResultExportDialog } from './ResultExportDialog'
import {
  dmlSuccessMessage,
  queryToolbarReadiness,
  resultTabPanelAttributes,
  subTabLabelledBy,
  type DisplayStatus,
} from './result-panel-model'
import type { ResultPanelControllers } from './use-result-panel-controllers'

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-size-row text-light-on-surface-variant dark:text-dark-on-surface-variant">
      {children}
    </div>
  )
}

export function EmptyResultState({ isRunning }: { isRunning: boolean }) {
  if (isRunning) {
    return (
      <EmptyState>
        <DataViewSpinner />
        <span>Executing query...</span>
      </EmptyState>
    )
  }
  return (
    <EmptyState>
      <Play size={32} weight="duotone" className="opacity-20" />
      <span>Run a query to see results</span>
    </EmptyState>
  )
}

export function ExpiredResultState({
  isRestoring,
  onRetry,
}: {
  isRestoring: boolean
  onRetry: () => void
}) {
  return (
    <EmptyState>
      <ClockCountdown
        weight="duotone"
        size={32}
        aria-hidden="true"
        className="opacity-35 text-light-on-surface-variant dark:text-dark-on-surface-variant"
      />
      <div className="max-w-80 text-center">
        <div className="text-size-body font-semibold text-light-on-surface dark:text-dark-on-surface">
          Results expired
        </div>
        <div className="mt-1 text-size-caption text-light-on-surface-variant opacity-60 dark:text-dark-on-surface-variant">
          Cached results are no longer available.
        </div>
      </div>
      <Button
        onClick={onRetry}
        disabled={isRestoring}
        className="mt-2"
        data-testid="retry-expired-button"
      >
        Re-run query
      </Button>
    </EmptyState>
  )
}

export interface ResultPanelLocation {
  tabId: string
  connectionId: string
  hideSubTabs: boolean
  showsSubTabs: boolean
}

export interface ResultStatusViewProps {
  location: ResultPanelLocation
  controllers: ResultPanelControllers
  displayStatus: DisplayStatus
  isTabRunning: boolean
}

function resultMessage(result: SingleResultState): ReactNode {
  if (result.resultStatus === 'error') {
    return (
      <DataViewMessage>
        <InfoBar
          severity="error"
          title="Query failed"
          message={result.errorMessage}
          data-testid="result-error"
        />
      </DataViewMessage>
    )
  }
  const hasColumns = result.view.slot.columns.length > 0
  if (hasColumns) return null
  return (
    <DataViewMessage>
      <InfoBar
        severity="success"
        title="Query OK"
        message={dmlSuccessMessage(result.affectedRows)}
        data-testid="dml-success"
      />
    </DataViewMessage>
  )
}

function resultPanelAttributes(location: ResultPanelLocation, resultIndex: number) {
  const { tabId, hideSubTabs, showsSubTabs } = location
  const panelId = `result-tabpanel-${tabId}-${resultIndex}`
  const labelledBy = subTabLabelledBy(showsSubTabs, tabId, resultIndex)
  return resultTabPanelAttributes(hideSubTabs, panelId, labelledBy)
}

function resultSlots({
  location,
  controllers,
  isTabRunning,
}: ResultStatusViewProps): DataViewSlots {
  const { surfaceRef, activeResult } = controllers
  return {
    editTarget: <EditModeDropdown surfaceRef={surfaceRef} connectionId={location.connectionId} />,
    bands: (
      <ResultBands surfaceRef={surfaceRef} result={activeResult} isTabRunning={isTabRunning} />
    ),
    exportDialog: (
      <ResultExportDialog
        surfaceRef={surfaceRef}
        connectionId={location.connectionId}
        isOpen={activeResult.view.prompts.isExportOpen}
      />
    ),
  }
}

export function ResultStatusView(props: ResultStatusViewProps) {
  const { location, controllers, displayStatus } = props
  if (displayStatus === 'idle') return <EmptyResultState isRunning={false} />
  if (displayStatus === 'running') return <EmptyResultState isRunning={true} />
  const { activeResult, activeResultIndex } = controllers
  return (
    <>
      {location.showsSubTabs && <ResultSubTabs tabId={location.tabId} />}
      <DataViewBody
        source={controllers.source}
        slots={resultSlots(props)}
        readiness={queryToolbarReadiness(activeResult, displayStatus)}
        panelAttributes={resultPanelAttributes(location, activeResultIndex)}
        message={resultMessage(activeResult)}
      />
    </>
  )
}
