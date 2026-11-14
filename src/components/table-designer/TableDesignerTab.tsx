import { useEffect } from 'react'
import { useTableDesignerStore } from '../../stores/table-designer-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import type { TableDesignerTab as TableDesignerTabType } from '../../types/schema'
import { UnsavedChangesDialog } from '../shared/UnsavedChangesDialog'
import { ApplySchemaChangesDialog } from './ApplySchemaChangesDialog'
import { designerTabView } from './table-designer-tab/designer-tab-view'
import {
  DesignerContent,
  DesignerHeader,
  DesignerSubTabBar,
} from './table-designer-tab/DesignerParts'
import { useDesignerApplyFlow } from './table-designer-tab/use-designer-apply-flow'
import styles from './TableDesignerTab.module.css'

interface TableDesignerTabProps {
  tab: TableDesignerTabType
  isActive?: boolean
}

function useInitDesignerTab(tab: TableDesignerTabType): void {
  const { id: tabId, mode, connectionId, databaseName, objectName } = tab
  const initTab = useTableDesignerStore((state) => state.initTab)
  const loadSchema = useTableDesignerStore((state) => state.loadSchema)
  useEffect(() => {
    const existing = useTableDesignerStore.getState().tabs[tabId]
    if (existing) return
    initTab(tabId, {
      mode: mode,
      connectionId: connectionId,
      databaseName: databaseName,
      objectName: objectName,
    })
    if (mode === 'alter') {
      void loadSchema(tabId)
    }
  }, [tabId, mode, connectionId, databaseName, objectName, initTab, loadSchema])
}

function useBlockingNavigation(tabId: string, isBlocking: boolean): void {
  const setBlockingNavigation = useWorkspaceStore((state) => state.setBlockingNavigation)
  useEffect(() => {
    setBlockingNavigation(tabId, isBlocking)
    return () => setBlockingNavigation(tabId, false)
  }, [isBlocking, setBlockingNavigation, tabId])
}

export function TableDesignerTab({ tab, isActive = true }: TableDesignerTabProps) {
  const { id: tabId, mode, connectionId, databaseName, objectName } = tab
  const tabState = useTableDesignerStore((state) => state.tabs[tabId])
  const discardChanges = useTableDesignerStore((state) => state.discardChanges)
  const updateTableName = useTableDesignerStore((state) => state.updateTableName)
  const setSelectedSubTab = useTableDesignerStore((state) => state.setSelectedSubTab)
  useInitDesignerTab(tab)
  const flow = useDesignerApplyFlow({ tab, isActive })
  const view = designerTabView(tabState, mode)
  const hasPendingNavigation = view.pendingNavigationAction !== null
  useBlockingNavigation(tabId, hasPendingNavigation || flow.isApplyDialogOpen)
  const isUnsavedChangesDialogVisible = hasPendingNavigation && !flow.isApplyDialogOpen

  return (
    <div className={styles.container} data-testid="table-designer-tab">
      <DesignerHeader
        view={view}
        objectName={objectName}
        databaseName={databaseName}
        onTableNameChange={(name) => updateTableName(tabId, name)}
        onDiscard={() => discardChanges(tabId)}
        onApply={() => void flow.prepareApplyDialog()}
      />
      <DesignerSubTabBar
        selectedSubTab={view.selectedSubTab}
        onSelect={(subTabKey) => setSelectedSubTab(tabId, subTabKey)}
      />
      <div className={styles.content} data-testid="table-designer-content">
        <DesignerContent
          view={view}
          subTab={{ tabId: tabId, connectionId: connectionId, databaseName: databaseName }}
        />
      </div>
      <ApplySchemaChangesDialog
        isOpen={flow.isApplyDialogOpen}
        ddl={view.ddl}
        warnings={view.ddlWarnings}
        connectionId={connectionId}
        database={databaseName}
        schemaMode={view.mode}
        tableLabel={`${databaseName}.${view.tableName.trim() || objectName}`}
        onSuccess={() => void flow.handleApplySuccess()}
        onCancel={flow.handleApplyCancel}
      />
      {isUnsavedChangesDialogVisible && (
        <UnsavedChangesDialog
          tabId={tabId}
          onSave={flow.handleSaveNavigation}
          onDiscard={flow.handleDiscardNavigation}
          onCancel={flow.handleCancelNavigation}
          title="Unsaved schema changes"
          message="You have unsaved table design changes. What would you like to do?"
          saveLabel="Apply changes"
        />
      )}
    </div>
  )
}

export default TableDesignerTab
