import { lazy, memo, Suspense } from 'react'
import { TableDataTab } from '../table-data/TableDataTab'
import { SchemaInfoTab } from '../schema-info/SchemaInfoTab'
import { QueryEditorTab } from '../query-editor/QueryEditorTab'
import { HistoryTab as HistoryTabComponent } from '../history/HistoryTab'
import ProcessListTabComponent from '../processlist/ProcessListTab'
import TableDesignerSkeleton from '../skeletons/TableDesignerSkeleton'
import MonacoEditorSkeleton from '../skeletons/MonacoEditorSkeleton'
import type {
  HistoryTab as HistoryTabType,
  ObjectEditorTab as ObjectEditorTabType,
  QueryEditorTab as QueryEditorTabType,
  SchemaInfoTab as SchemaInfoTabType,
  TableDesignerTab as TableDesignerTabType,
  WorkspaceTab,
} from '../../types/schema'
import styles from './WorkspaceTabPanel.module.css'

const LazyTableDesignerTab = lazy(() => import('../table-designer/TableDesignerTab'))
const LazyObjectEditorTab = lazy(() => import('../object-editor/ObjectEditorTab'))

export interface WorkspaceTabPanelProps {
  tab: WorkspaceTab
  isActive?: boolean
  connectionId: string
  sessionId?: string
}

function panelVisibilityProps(isActive: boolean) {
  if (isActive) return { className: styles.panel }
  return { className: `${styles.panel} ${styles.inactive}`, 'aria-hidden': true, tabIndex: -1 }
}

interface WorkspaceTabContentProps {
  tab: WorkspaceTab
  isActive: boolean
  connection: { connectionId: string; sessionId: string | undefined }
}

function WorkspaceTabContent({ tab, isActive, connection }: WorkspaceTabContentProps) {
  if (tab.type === 'table-data') return <TableDataTab tab={tab} isActive={isActive} />
  if (tab.type === 'schema-info') {
    return <SchemaInfoTab tab={tab as SchemaInfoTabType} isActive={isActive} />
  }
  if (tab.type === 'query-editor') {
    return <QueryEditorTab tab={tab as QueryEditorTabType} isActive={isActive} />
  }
  if (tab.type === 'table-designer') {
    return (
      <Suspense fallback={<TableDesignerSkeleton />}>
        <LazyTableDesignerTab tab={tab as TableDesignerTabType} isActive={isActive} />
      </Suspense>
    )
  }
  if (tab.type === 'object-editor') {
    return (
      <Suspense fallback={<MonacoEditorSkeleton />}>
        <LazyObjectEditorTab tab={tab as ObjectEditorTabType} isActive={isActive} />
      </Suspense>
    )
  }
  if (tab.type === 'history') {
    return <HistoryTabComponent tab={tab as HistoryTabType} isActive={isActive} />
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

// Memoized so switching tabs re-renders only the two panels whose isActive flips,
// not every retained editor/grid.
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
