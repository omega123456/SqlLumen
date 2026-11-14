import type { ComponentProps } from 'react'
import type { FkLookupArgs } from '../../shared/fk-lookup-context'
import { FkLookupProvider } from '../../shared/fk-lookup-context'
import { InfoBar } from '../../common/InfoBar'
import { ResultSubTabs } from '../ResultSubTabs'
import { ResultToolbar } from '../ResultToolbar'
import { ResultBands } from './ResultBands'
import { ResultViews, type ResultViewsProps } from './ResultViews'
import { ResultActivityOverlay, EmptyResultState } from './ResultStatusViews'
import {
  dmlSuccessMessage,
  type DisplayStatus,
  type TabPanelAttributes,
} from './result-panel-model'
import styles from '../ResultPanel.module.css'

type ResultToolbarProps = ComponentProps<typeof ResultToolbar>

export interface ResultBodyProps {
  tabPanelAttributes: TabPanelAttributes
  className: string
  displayStatus: DisplayStatus
  toolbar: ResultToolbarProps
  views: ResultViewsProps
  isTabRunning: boolean
  onForeignKeyLookup: (args: FkLookupArgs) => Promise<void>
}

function ResultContent({ views, isTabRunning, onForeignKeyLookup }: ResultBodyProps) {
  const { result } = views
  const hasNoColumns = result.columns.length === 0
  if (hasNoColumns) {
    return (
      <div className={styles.infoBody}>
        <InfoBar
          severity="success"
          title="Query OK"
          message={dmlSuccessMessage(result.affectedRows)}
          data-testid="dml-success"
        />
      </div>
    )
  }
  return (
    <>
      <ResultBands tabId={views.tabId} result={result} isTabRunning={isTabRunning} />
      <FkLookupProvider onFkLookup={onForeignKeyLookup}>
        <ResultViews {...views} />
      </FkLookupProvider>
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

function ErrorResultBody({ tabPanelAttributes, toolbar, views }: ResultBodyProps) {
  return (
    <div {...tabPanelAttributes} className={styles.tabPanel}>
      <ResultToolbar {...toolbar} isCloneDisabled={true} />
      <div className={styles.infoBody}>
        <InfoBar
          severity="error"
          title="Query failed"
          message={views.result.errorMessage}
          data-testid="result-error"
        />
      </div>
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
  const subTabs = showsSubTabs ? <ResultSubTabs tabId={body.views.tabId} /> : null
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
        isSorting={body.views.result.isSorting}
      />
    </>
  )
}
