import { Wrench } from '@phosphor-icons/react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { showErrorToast } from '../../stores/toast-store'
import { useSchemaStore } from '../../stores/schema-store'
import {
  useTableDesignerStore,
  type TableDesignerTabState,
} from '../../stores/table-designer-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { invalidateSchemaIndex } from '../../lib/schema-index-commands'
import type { DesignerSubTab, TableDesignerTab as TableDesignerTabType } from '../../types/schema'
import { Button } from '../common/Button'
import { TextInput } from '../common/TextInput'
import { UnderlineTab, UnderlineTabBar } from '../common/UnderlineTabs'
import { UnsavedChangesDialog } from '../shared/UnsavedChangesDialog'
import { ApplySchemaChangesDialog } from './ApplySchemaChangesDialog'
import { ColumnEditor } from './ColumnEditor'
import { DdlPreviewTab } from './DdlPreviewTab'
import { ForeignKeyEditor } from './ForeignKeyEditor'
import { IndexEditor } from './IndexEditor'
import { TablePropertiesEditor } from './TablePropertiesEditor'
import styles from './TableDesignerTab.module.css'

import { logFrontendError } from '../../lib/app-log-commands'
import { toErrorMessage } from '../../lib/error-message'
interface TableDesignerTabProps {
  tab: TableDesignerTabType
  isActive?: boolean
}

const SUB_TAB_ORDER: readonly DesignerSubTab[] = ['columns', 'indexes', 'fks', 'properties', 'ddl']

const SUB_TAB_LABELS: Record<DesignerSubTab, string> = {
  columns: 'Columns',
  indexes: 'Indexes',
  fks: 'Foreign keys',
  properties: 'Table properties',
  ddl: 'DDL preview',
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

interface DesignerTabView {
  mode: TableDesignerTabState['mode']
  validationErrors: Record<string, string>
  pendingNavigationAction: TableDesignerTabState['pendingNavigationAction']
  isDirty: boolean
  isLoading: boolean
  isDdlLoading: boolean
  loadError: string | null
  selectedSubTab: DesignerSubTab
  ddl: string
  ddlWarnings: string[]
  tableName: string
  columnCount: number
}

const NO_VALIDATION_ERRORS: Record<string, string> = {}
const NO_DDL_WARNINGS: string[] = []

function designerTabView(
  tabState: TableDesignerTabState | undefined,
  mode: TableDesignerTabState['mode']
): DesignerTabView {
  if (!tabState) {
    return {
      mode: mode,
      validationErrors: NO_VALIDATION_ERRORS,
      pendingNavigationAction: null,
      isDirty: false,
      isLoading: mode === 'alter',
      isDdlLoading: false,
      loadError: null,
      selectedSubTab: 'columns',
      ddl: '',
      ddlWarnings: NO_DDL_WARNINGS,
      tableName: '',
      columnCount: 0,
    }
  }
  return {
    mode: tabState.mode,
    validationErrors: tabState.validationErrors,
    pendingNavigationAction: tabState.pendingNavigationAction,
    isDirty: tabState.isDirty,
    isLoading: tabState.isLoading,
    isDdlLoading: tabState.isDdlLoading,
    loadError: tabState.loadError,
    selectedSubTab: tabState.selectedSubTab,
    ddl: tabState.ddl,
    ddlWarnings: tabState.ddlWarnings,
    tableName: tabState.currentSchema.tableName,
    columnCount: tabState.currentSchema.columns.length,
  }
}

function isApplyDisabled(view: DesignerTabView): boolean {
  if (!view.isDirty) return true
  if (view.isDdlLoading) return true
  if (Object.keys(view.validationErrors).length > 0) return true
  return view.mode === 'create' && view.tableName.trim() === ''
}

function pluralizeColumns(columnCount: number): string {
  return `${columnCount} ${columnCount === 1 ? 'column' : 'columns'}`
}

interface DesignerHeadingProps {
  isCreateMode: boolean
  tableName: string
  objectName: string
  onTableNameChange: (name: string) => void
}

function DesignerHeading({
  isCreateMode,
  tableName,
  objectName,
  onTableNameChange,
}: DesignerHeadingProps) {
  if (!isCreateMode) {
    return <h1 className={styles.heading}>Alter table {tableName || objectName}</h1>
  }
  return (
    <>
      <h1 className={styles.heading}>Create table</h1>
      <TextInput
        variant="bare"
        type="text"
        value={tableName}
        placeholder="table_name"
        className={`ui-field-chrome ${styles.tableNameInput}`}
        data-testid="table-designer-name-input"
        onChange={(event) => onTableNameChange(event.target.value)}
      />
    </>
  )
}

interface SubTabContentProps {
  tabId: string
  connectionId: string
  databaseName: string
}

const SUB_TAB_CONTENT: Record<DesignerSubTab, (props: SubTabContentProps) => ReactNode> = {
  columns: ({ tabId }) => <ColumnEditor tabId={tabId} />,
  indexes: ({ tabId }) => <IndexEditor tabId={tabId} />,
  fks: ({ tabId }) => <ForeignKeyEditor tabId={tabId} />,
  properties: ({ tabId, connectionId, databaseName }) => (
    <TablePropertiesEditor tabId={tabId} connectionId={connectionId} databaseName={databaseName} />
  ),
  ddl: ({ tabId }) => <DdlPreviewTab tabId={tabId} />,
}

interface DesignerContentProps {
  view: DesignerTabView
  subTab: SubTabContentProps
}

function DesignerContent({ view, subTab }: DesignerContentProps) {
  if (view.loadError) {
    return (
      <div className={styles.errorState} data-testid="table-designer-error">
        {view.loadError}
      </div>
    )
  }

  if (view.isLoading) {
    return (
      <div className={styles.loadingState} data-testid="table-designer-loading">
        <div className={styles.spinner} aria-hidden />
        <span>Loading table schema...</span>
      </div>
    )
  }

  const renderSubTab = SUB_TAB_CONTENT[view.selectedSubTab]
  return renderSubTab(subTab)
}

export function TableDesignerTab({ tab, isActive = true }: TableDesignerTabProps) {
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
  const setBlockingNavigation = useWorkspaceStore((state) => state.setBlockingNavigation)

  const [isApplyDialogOpen, setIsApplyDialogOpen] = useState(false)
  const [previousIsActive, setPreviousIsActive] = useState(isActive)
  const postApplyActionRef = useRef<(() => void) | null>(null)

  const hasBecomeInactive = previousIsActive && !isActive
  if (previousIsActive !== isActive) {
    setPreviousIsActive(isActive)
  }
  if (hasBecomeInactive) {
    setIsApplyDialogOpen(false)
  }

  useEffect(() => {
    const existing = useTableDesignerStore.getState().tabs[tabId]
    if (!existing) {
      initTab(tabId, {
        mode: mode,
        connectionId: connectionId,
        databaseName: databaseName,
        objectName: objectName,
      })
      if (mode === 'alter') {
        void loadSchema(tabId)
      }
    }
  }, [tabId, mode, connectionId, databaseName, objectName, initTab, loadSchema])

  const view = designerTabView(tabState, mode)
  const { pendingNavigationAction, selectedSubTab, tableName } = view
  const isCreateMode = view.mode === 'create'
  const applyTableLabel = `${databaseName}.${tableName.trim() || objectName}`

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
    }
    await loadSchema(tabId)

    await refreshCategory(connectionId, databaseName, 'table')

    // Invalidate schema index for the modified table (fire-and-forget)
    const qualifiedName = `${databaseName}.${latestTableName}`
    invalidateSchemaIndex(connectionId, [qualifiedName]).catch((error) => {
      const message = toErrorMessage(error)
      logFrontendError('[table-designer] Schema index invalidation failed:', message)
    })

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

  useEffect(() => {
    setBlockingNavigation(tabId, pendingNavigationAction !== null || isApplyDialogOpen)
    return () => setBlockingNavigation(tabId, false)
  }, [isApplyDialogOpen, pendingNavigationAction, setBlockingNavigation, tabId])

  useEffect(() => {
    if (isActive) return
    postApplyActionRef.current = null
  }, [isActive])

  const isUnsavedChangesDialogVisible = pendingNavigationAction !== null && !isApplyDialogOpen

  return (
    <div className={styles.container} data-testid="table-designer-tab">
      {/* Page header (prototype `.vh`): icon tile, title and caption, then the actions */}
      <div className={styles.header} data-testid="table-designer-header">
        <span className={styles.tile} aria-hidden>
          <Wrench size={16} weight="regular" />
        </span>
        <div className={styles.headingStack}>
          <DesignerHeading
            isCreateMode={isCreateMode}
            tableName={tableName}
            objectName={objectName}
            onTableNameChange={(name) => updateTableName(tabId, name)}
          />
          <span className={styles.caption} data-testid="table-designer-caption">
            {databaseName} · {pluralizeColumns(view.columnCount)}
          </span>
        </div>
        <Button
          onClick={() => discardChanges(tabId)}
          disabled={!view.isDirty}
          data-testid="table-designer-discard"
        >
          Discard
        </Button>
        <Button
          variant="accent"
          disabled={isApplyDisabled(view)}
          onClick={() => void prepareApplyDialog()}
          data-testid="table-designer-apply"
        >
          Apply changes
        </Button>
      </div>

      <UnderlineTabBar className={styles.subTabBar} data-testid="table-designer-subtabs">
        {SUB_TAB_ORDER.map((subTabKey) => (
          <UnderlineTab
            key={subTabKey}
            active={selectedSubTab === subTabKey}
            data-testid={`table-designer-subtab-${subTabKey}`}
            onClick={() => setSelectedSubTab(tabId, subTabKey)}
          >
            {SUB_TAB_LABELS[subTabKey]}
          </UnderlineTab>
        ))}
      </UnderlineTabBar>

      <div className={styles.content} data-testid="table-designer-content">
        <DesignerContent
          view={view}
          subTab={{
            tabId: tabId,
            connectionId: connectionId,
            databaseName: databaseName,
          }}
        />
      </div>

      <ApplySchemaChangesDialog
        isOpen={isApplyDialogOpen}
        ddl={view.ddl}
        warnings={view.ddlWarnings}
        connectionId={connectionId}
        database={databaseName}
        schemaMode={view.mode}
        tableLabel={applyTableLabel}
        onSuccess={() => {
          void handleApplySuccess()
        }}
        onCancel={handleApplyCancel}
      />

      {isUnsavedChangesDialogVisible && (
        <UnsavedChangesDialog
          tabId={tabId}
          onSave={handleSaveNavigation}
          onDiscard={handleDiscardNavigation}
          onCancel={handleCancelNavigation}
          title="Unsaved schema changes"
          message="You have unsaved table design changes. What would you like to do?"
          saveLabel="Apply changes"
        />
      )}
    </div>
  )
}

export default TableDesignerTab
