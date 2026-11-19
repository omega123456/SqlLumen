import type { ComponentProps, ReactNode } from 'react'
import { InfoBar } from '../../common/InfoBar'
import { ResultSubTabs } from '../ResultSubTabs'
import { ResultToolbar } from '../ResultToolbar'
import { ResultBands } from './ResultBands'
import { ResultViews, type ResultViewsProps } from './ResultViews'
import type { SingleResultState } from '../../../stores/query-store'
import { ResultActivityOverlay, EmptyResultState } from './ResultStatusViews'
import {
  dmlSuccessMessage,
  NO_ROW_INSERTION,
  type DisplayStatus,
  type TabPanelAttributes,
} from './result-panel-model'
import { joinClassNames, SCROLLBAR } from '../../../lib/class-names'
import { RESULT_TAB_PANEL } from './result-panel-classes'

type ResultToolbarProps = ComponentProps<typeof ResultToolbar>

export interface ResultBodyProps {
  tabPanelAttributes: TabPanelAttributes
  className: string
  displayStatus: DisplayStatus
  toolbar: ResultToolbarProps
  views: ResultViewsProps
  tabId: string
  result: SingleResultState
  isTabRunning: boolean
}

function InfoBody({ children }: { children: ReactNode }) {
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

function ResultContent({ views, result, isTabRunning }: ResultBodyProps) {
  const hasNoColumns = result.view.slot.columns.length === 0
  if (hasNoColumns) {
    return (
      <InfoBody>
        <InfoBar
          severity="success"
          title="Query OK"
          message={dmlSuccessMessage(result.affectedRows)}
          data-testid="dml-success"
        />
      </InfoBody>
    )
  }
  return (
    <>
      <ResultBands surfaceRef={views.source.ref} result={result} isTabRunning={isTabRunning} />
      <ResultViews {...views} />
    </>
  )
}

function SuccessResultBody(props: ResultBodyProps) {
  return (
    <div
      {...props.tabPanelAttributes}
      className={props.className}
      aria-busy={props.displayStatus === 'restoring'}
    >
      <ResultToolbar {...props.toolbar} />
      <ResultContent {...props} />
    </div>
  )
}

function ErrorResultBody({ tabPanelAttributes, toolbar, result }: ResultBodyProps) {
  return (
    <div {...tabPanelAttributes} className={RESULT_TAB_PANEL}>
      <ResultToolbar {...toolbar} rowInsertion={NO_ROW_INSERTION} />
      <InfoBody>
        <InfoBar
          severity="error"
          title="Query failed"
          message={result.errorMessage}
          data-testid="result-error"
        />
      </InfoBody>
    </div>
  )
}

interface ResultStatusViewProps {
  showsSubTabs: boolean
  body: ResultBodyProps
}

export function ResultStatusView({ showsSubTabs, body }: ResultStatusViewProps) {
  const { displayStatus } = body
  if (displayStatus === 'idle') return <EmptyResultState isRunning={false} />
  if (displayStatus === 'running') return <EmptyResultState isRunning={true} />
  const subTabs = showsSubTabs ? <ResultSubTabs tabId={body.tabId} /> : null
  if (displayStatus === 'error') {
    return (
      <>
        {subTabs}
        <ErrorResultBody {...body} />
      </>
    )
  }
  return (
    <>
      {subTabs}
      <SuccessResultBody {...body} />
      <ResultActivityOverlay
        displayStatus={displayStatus}
        isSorting={body.result.view.spec.applying === 'sort'}
      />
    </>
  )
}
