import { lazy, memo, Suspense } from 'react'
import { TableDataTab } from '../table-data/TableDataTab'
import { SchemaInfoTab } from '../schema-info/SchemaInfoTab'
import { QueryEditorTab } from '../query-editor/QueryEditorTab'
import { HistoryTab as HistoryTabComponent } from '../history/HistoryTab'
import ProcessListTabComponent from '../processlist/ProcessListTab'
import TableDesignerSkeleton from '../skeletons/TableDesignerSkeleton'
import MonacoEditorSkeleton from '../skeletons/MonacoEditorSkeleton'
import type { WorkspaceTab } from '../../types/schema'
import { RETAINED_HIDDEN_STYLE } from '../../lib/retained-hidden-style'

const LazyTableDesignerTab = lazy(() => import('../table-designer/TableDesignerTab'))
const LazyObjectEditorTab = lazy(() => import('../object-editor/ObjectEditorTab'))

export interface WorkspaceTabPanelProps {
  tab: WorkspaceTab
  isActive?: boolean
  connectionId: string
  sessionId?: string
}

const ACTIVE_PANEL_CLASS_NAME = 'absolute inset-0 overflow-hidden'
const INACTIVE_PANEL_CLASS_NAME =
  'pointer-events-none absolute inset-0 overflow-hidden aria-hidden:invisible'

function panelVisibilityProps(isActive: boolean) {
  if (isActive) return { className: ACTIVE_PANEL_CLASS_NAME }
  return {
    className: INACTIVE_PANEL_CLASS_NAME,
    style: RETAINED_HIDDEN_STYLE,
    'aria-hidden': true,
    tabIndex: -1,
    'data-animation-paused': true,
  }
}

interface WorkspaceTabContentProps {
  tab: WorkspaceTab
  isActive: boolean
  connection: { connectionId: string; sessionId: string | undefined }
}

function WorkspaceTabContent({ tab, isActive, connection }: WorkspaceTabContentProps) {
  if (tab.type === 'table-data') return <TableDataTab tab={tab} isActive={isActive} />
  if (tab.type === 'schema-info') {
    return <SchemaInfoTab tab={tab} isActive={isActive} />
  }
  if (tab.type === 'query-editor') {
    return <QueryEditorTab tab={tab} isActive={isActive} />
  }
  if (tab.type === 'table-designer') {
    return (
      <Suspense fallback={<TableDesignerSkeleton />}>
        <LazyTableDesignerTab tab={tab} isActive={isActive} />
      </Suspense>
    )
  }
  if (tab.type === 'object-editor') {
    return (
      <Suspense fallback={<MonacoEditorSkeleton />}>
        <LazyObjectEditorTab tab={tab} isActive={isActive} />
      </Suspense>
    )
  }
  if (tab.type === 'history') {
    return <HistoryTabComponent tab={tab} isActive={isActive} />
  }
  if (tab.type === 'processlist') {
    return (
      <ProcessListTabComponent
        connectionId={connection.connectionId}
        sessionId={connection.sessionId ?? connection.connectionId}
        workspaceTabId={tab.id}
        isActive={isActive}
      />
    )
  }
  return null
}

export const WorkspaceTabPanel = memo(function WorkspaceTabPanel({
  tab,
  isActive = true,
  connectionId,
  sessionId,
}: WorkspaceTabPanelProps) {
  return (
    <div
      {...panelVisibilityProps(isActive)}
      data-testid="workspace-panel"
      data-tab-id={tab.id}
      data-active={isActive}
    >
      <WorkspaceTabContent
        tab={tab}
        isActive={isActive}
        connection={{ connectionId: connectionId, sessionId: sessionId }}
      />
    </div>
  )
})
