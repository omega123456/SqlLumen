import { Table } from '@phosphor-icons/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { showErrorToast } from '../../stores/toast-store'
import { useSchemaStore } from '../../stores/schema-store'
import { useTableDesignerStore } from '../../stores/table-designer-store'
import { useThemeStore } from '../../stores/theme-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import type { DesignerSubTab, TableDesignerTab as TableDesignerTabType } from '../../types/schema'
import { Button } from '../common/Button'
import { ElevatedSurface } from '../common/ElevatedSurface'
import { UnderlineTab, UnderlineTabBar } from '../common/UnderlineTabs'
import { UnsavedChangesDialog } from '../shared/UnsavedChangesDialog'
import { ApplySchemaChangesDialog } from './ApplySchemaChangesDialog'
import { ColumnEditor } from './ColumnEditor'
import { DdlPreviewTab } from './DdlPreviewTab'
import { ForeignKeyEditor } from './ForeignKeyEditor'
import { IndexEditor } from './IndexEditor'
import { TablePropertiesEditor } from './TablePropertiesEditor'
import styles from './TableDesignerTab.module.css'

interface TableDesignerTabProps {
  tab: TableDesignerTabType
}

const SUB_TAB_LABELS: Record<DesignerSubTab, string> = {
  columns: 'Columns',
  indexes: 'Indexes',
  fks: 'Foreign Keys',
  properties: 'Table Properties',
  ddl: 'DDL Preview',
}

function clearPendingNavigationAction(tabId: string) {
  useTableDesignerStore.setState((state) => {
    const existing = state.tabs[tabId]
    if (!existing) {
      return state
    }

    return {
      tabs: {
        ...state.tabs,
        [tabId]: {
          ...existing,
          pendingNavigationAction: null,
        },
      },
    }
  })
}

export function TableDesignerTab({ tab }: TableDesignerTabProps) {
  const { id: tabId, mode, connectionId, databaseName, objectName } = tab

  const tabState = useTableDesignerStore((state) => state.tabs[tabId])
  const initTab = useTableDesignerStore((state) => state.initTab)
  const loadSchema = useTableDesignerStore((state) => state.loadSchema)
  const discardChanges = useTableDesignerStore((state) => state.discardChanges)
  const regenerateDdl = useTableDesignerStore((state) => state.regenerateDdl)
  const updateTableName = useTableDesignerStore((state) => state.updateTableName)
  const updateTabContext = useTableDesignerStore((state) => state.updateTabContext)
  const setSelectedSubTab = useTableDesignerStore((state) => state.setSelectedSubTab)

  const refreshCategory = useSchemaStore((state) => state.refreshCategory)
  const updateWorkspaceDesignerTab = useWorkspaceStore((state) => state.updateTableDesignerTab)
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)

  const [isApplyDialogOpen, setIsApplyDialogOpen] = useState(false)
  const postApplyActionRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const existing = useTableDesignerStore.getState().tabs[tabId]
    if (!existing) {
      initTab(tabId, mode, connectionId, databaseName, objectName)
      if (mode === 'alter') {
        void loadSchema(tabId)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, mode, connectionId, databaseName, objectName])

  const currentSchema = tabState?.currentSchema
  const validationErrors = tabState?.validationErrors ?? {}
  const pendingNavigationAction = tabState?.pendingNavigationAction ?? null
  const isDirty = tabState?.isDirty ?? false
  const isLoading = tabState?.isLoading ?? mode === 'alter'
  const isDdlLoading = tabState?.isDdlLoading ?? false
  const loadError = tabState?.loadError ?? null
  const selectedSubTab = tabState?.selectedSubTab ?? 'columns'
  const ddl = tabState?.ddl ?? ''
  const ddlWarnings = tabState?.ddlWarnings ?? []
  const tableName = currentSchema?.tableName ?? ''
  const hasValidationErrors = Object.keys(validationErrors).length > 0
  const isCreateMode = (tabState?.mode ?? mode) === 'create'

  const isApplyDisabled =
    !isDirty || hasValidationErrors || isDdlLoading || (isCreateMode && tableName.trim() === '')

  const prepareApplyDialog = useCallback(
    async (postApplyAction: (() => void) | null = null) => {
      postApplyActionRef.current = postApplyAction
      await regenerateDdl(tabId)

      const latest = useTableDesignerStore.getState().tabs[tabId]
      if (!latest) {
        postApplyActionRef.current = null
        return
      }

      if (latest.ddlError) {
        showErrorToast('Failed to prepare schema changes', latest.ddlError)
        postApplyActionRef.current = null
        return
      }

      setIsApplyDialogOpen(true)
    },
    [regenerateDdl, tabId]
  )

  const handleApplySuccess = useCallback(async () => {
    setIsApplyDialogOpen(false)

    const latest = useTableDesignerStore.getState().tabs[tabId]
    if (!latest) {
      postApplyActionRef.current = null
      return
    }

    const latestTableName = latest.currentSchema.tableName

    if (latest.mode === 'create') {
      updateWorkspaceDesignerTab(tabId, {
        mode: 'alter',
        objectName: latestTableName,
        label: latestTableName,
      })
      updateTabContext(tabId, { mode: 'alter', objectName: latestTableName })
      await loadSchema(tabId)
    } else {
      await loadSchema(tabId)
    }

    await refreshCategory(connectionId, databaseName, 'table')

    const action = postApplyActionRef.current
    postApplyActionRef.current = null
    if (action) {
      clearPendingNavigationAction(tabId)
      action()
    }
  }, [
    connectionId,
    databaseName,
    loadSchema,
    refreshCategory,
    tabId,
    updateTabContext,
    updateWorkspaceDesignerTab,
  ])

  const handleApplyCancel = useCallback(() => {
    setIsApplyDialogOpen(false)
    postApplyActionRef.current = null
  }, [])

  const handleSaveNavigation = useCallback(async () => {
    const action = useTableDesignerStore.getState().tabs[tabId]?.pendingNavigationAction ?? null
    await prepareApplyDialog(action)
  }, [prepareApplyDialog, tabId])

  const handleDiscardNavigation = useCallback(() => {
    const action = useTableDesignerStore.getState().tabs[tabId]?.pendingNavigationAction ?? null
    discardChanges(tabId)
    clearPendingNavigationAction(tabId)
    action?.()
  }, [discardChanges, tabId])

  const handleCancelNavigation = useCallback(() => {
    clearPendingNavigationAction(tabId)
  }, [tabId])

  const renderContent = () => {
    switch (selectedSubTab) {
      case 'columns':
        return <ColumnEditor tabId={tabId} />
      case 'indexes':
        return <IndexEditor tabId={tabId} />
      case 'fks':
        return <ForeignKeyEditor tabId={tabId} />
      case 'properties':
        return (
          <TablePropertiesEditor
            tabId={tabId}
            connectionId={connectionId}
            databaseName={databaseName}
          />
        )
      case 'ddl':
        return <DdlPreviewTab tabId={tabId} />
      default:
        return null
    }
  }

  return (
    <div className={styles.container} data-testid="table-designer-tab">
      <ElevatedSurface className={styles.headerCard} data-testid="table-designer-header-card">
        <div className={styles.header}>
          <div className={styles.headerMain}>
            <div className={styles.titleBlock}>
              <span
                className={`${styles.tableIcon} ${
                  resolvedTheme === 'dark' ? styles.tableIconDark : styles.tableIconLight
                }`}
                aria-hidden
              >
                <Table size={24} weight="fill" />
              </span>

              {isCreateMode ? (
                <div className={styles.headingStack}>
                  <h1 className={styles.heading}>Create Table</h1>
                  <input
                    type="text"
                    value={tableName}
                    placeholder="table_name"
                    className={styles.tableNameInput}
                    data-testid="table-designer-name-input"
                    onChange={(event) => updateTableName(tabId, event.target.value)}
                  />
                  {resolvedTheme === 'light' && isDirty && (
                    <div className={styles.unsavedSubtitle}>Unsaved Changes</div>
                  )}
                </div>
              ) : (
                <div className={styles.headingStack}>
                  <h1 className={styles.heading}>
                    Design Table:{' '}
                    <span className={styles.tableName}>{tableName || objectName}</span>
                  </h1>
                  {resolvedTheme === 'light' && isDirty && (
                    <div className={styles.unsavedSubtitle}>Unsaved Changes</div>
                  )}
                </div>
              )}
            </div>

            <div className={styles.headerActions}>
              <Button
                variant="secondary"
                className={styles.discardButton}
                onClick={() => discardChanges(tabId)}
                data-testid="table-designer-discard"
              >
                Discard
              </Button>
              <Button
                variant="primary"
                className={styles.applyButton}
                disabled={isApplyDisabled}
                onClick={() => void prepareApplyDialog()}
                data-testid="table-designer-apply"
              >
                Apply Changes{resolvedTheme === 'dark' && isDirty ? ' ●' : ''}
              </Button>
            </div>
          </div>

          <UnderlineTabBar className={styles.subTabBar} data-testid="table-designer-subtabs">
            {(Object.keys(SUB_TAB_LABELS) as DesignerSubTab[]).map((subTabKey) => (
              <UnderlineTab
                key={subTabKey}
                active={selectedSubTab === subTabKey}
                onClick={() => setSelectedSubTab(tabId, subTabKey)}
              >
                {SUB_TAB_LABELS[subTabKey]}
              </UnderlineTab>
            ))}
          </UnderlineTabBar>
        </div>
      </ElevatedSurface>

      <ElevatedSurface className={styles.contentCard} data-testid="table-designer-content-card">
        <div className={styles.content}>
          {isLoading && !loadError && (
            <div className={styles.loadingState} data-testid="table-designer-loading">
              <div className={styles.spinner} aria-hidden />
              <span>Loading table schema...</span>
            </div>
          )}

          {loadError && (
            <div className={styles.errorState} data-testid="table-designer-error">
              {loadError}
            </div>
          )}

          {!isLoading && !loadError && renderContent()}
        </div>
      </ElevatedSurface>

      <ApplySchemaChangesDialog
        isOpen={isApplyDialogOpen}
        ddl={ddl}
        warnings={ddlWarnings}
        connectionId={connectionId}
        database={databaseName}
        onSuccess={() => {
          void handleApplySuccess()
        }}
        onCancel={handleApplyCancel}
      />

      {pendingNavigationAction !== null && !isApplyDialogOpen && (
        <UnsavedChangesDialog
          tabId={tabId}
          onSave={handleSaveNavigation}
          onDiscard={handleDiscardNavigation}
          onCancel={handleCancelNavigation}
          title="Unsaved Schema Changes"
          message="You have unsaved table design changes. What would you like to do?"
          saveLabel="Apply Changes"
        />
      )}
    </div>
  )
}
