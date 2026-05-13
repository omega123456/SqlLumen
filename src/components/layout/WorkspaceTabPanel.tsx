import { TableDataTab } from '../table-data/TableDataTab'
import { SchemaInfoTab } from '../schema-info/SchemaInfoTab'
import { QueryEditorTab } from '../query-editor/QueryEditorTab'
import { TableDesignerTab as TableDesignerTabComponent } from '../table-designer/TableDesignerTab'
import { ObjectEditorTab as ObjectEditorTabComponent } from '../object-editor/ObjectEditorTab'
import { HistoryTab as HistoryTabComponent } from '../history/HistoryTab'
import ProcessListTabComponent from '../processlist/ProcessListTab'
import type {
  HistoryTab as HistoryTabType,
  ObjectEditorTab as ObjectEditorTabType,
  QueryEditorTab as QueryEditorTabType,
  SchemaInfoTab as SchemaInfoTabType,
  TableDesignerTab as TableDesignerTabType,
  WorkspaceTab,
} from '../../types/schema'
import styles from './WorkspaceTabPanel.module.css'

export interface WorkspaceTabPanelProps {
  tab: WorkspaceTab
  isActive?: boolean
  connectionId: string
  sessionId?: string
}

export function WorkspaceTabPanel({
  tab,
  isActive = true,
  connectionId,
  sessionId,
}: WorkspaceTabPanelProps) {
  const panelClassName = isActive ? styles.panel : `${styles.panel} ${styles.inactive}`

  return (
    <div
      className={panelClassName}
      data-testid="workspace-panel"
      data-tab-id={tab.id}
      data-active={isActive}
      aria-hidden={isActive ? undefined : true}
      tabIndex={isActive ? undefined : -1}
    >
      {tab.type === 'table-data' && <TableDataTab tab={tab} isActive={isActive} />}
      {tab.type === 'schema-info' && (
        <SchemaInfoTab tab={tab as SchemaInfoTabType} isActive={isActive} />
      )}
      {tab.type === 'query-editor' && (
        <QueryEditorTab tab={tab as QueryEditorTabType} isActive={isActive} />
      )}
      {tab.type === 'table-designer' && (
        <TableDesignerTabComponent tab={tab as TableDesignerTabType} isActive={isActive} />
      )}
      {tab.type === 'object-editor' && (
        <ObjectEditorTabComponent tab={tab as ObjectEditorTabType} isActive={isActive} />
      )}
      {tab.type === 'history' && (
        <HistoryTabComponent tab={tab as HistoryTabType} isActive={isActive} />
      )}
      {tab.type === 'processlist' && (
        <ProcessListTabComponent
          connectionId={connectionId}
          sessionId={sessionId ?? connectionId}
          workspaceTabId={tab.id}
          isActive={isActive}
        />
      )}
    </div>
  )
}
