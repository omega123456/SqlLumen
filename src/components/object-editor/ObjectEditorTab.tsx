import { useCallback, useEffect, type ReactNode } from 'react'
import { useObjectEditorStore, type ObjectEditorTabState } from '../../stores/object-editor-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import type { ObjectEditorTab as ObjectEditorTabType } from '../../types/schema'
import { MonacoEditorWrapper } from '../query-editor/MonacoEditorWrapper'
import { UnsavedChangesDialog } from '../shared/UnsavedChangesDialog'
import { ObjectEditorToolbar } from './ObjectEditorToolbar'
import { OBJECT_TYPE_LABELS } from './object-editor-constants'
import styles from './ObjectEditorTab.module.css'

interface ObjectEditorTabProps {
  tab: ObjectEditorTabType
  isActive?: boolean
}

interface ObjectEditorView {
  content: string
  isLoading: boolean
  isSaving: boolean
  error: string | null
  isDirty: boolean
  pendingNavigationAction: ObjectEditorTabState['pendingNavigationAction'] | null
  mode: ObjectEditorTabType['mode']
}

function deriveObjectEditorView(
  tabState: ObjectEditorTabState | undefined,
  tabMode: ObjectEditorTabType['mode']
): ObjectEditorView {
  if (!tabState) {
    return {
      content: '',
      isLoading: tabMode === 'alter',
      isSaving: false,
      error: null,
      isDirty: false,
      pendingNavigationAction: null,
      mode: tabMode,
    }
  }
  return {
    content: tabState.content,
    isLoading: tabState.isLoading,
    isSaving: tabState.isSaving,
    error: tabState.error,
    isDirty: tabState.content !== tabState.originalContent,
    pendingNavigationAction: tabState.pendingNavigationAction,
    mode: tabState.mode,
  }
}

interface ObjectEditorStatusViewProps {
  stateClassName: string
  testId: string
  children: ReactNode
}

function ObjectEditorStatusView({ stateClassName, testId, children }: ObjectEditorStatusViewProps) {
  return (
    <div className={styles.container} data-testid="object-editor-tab">
      <div className={stateClassName} data-testid={testId}>
        {children}
      </div>
    </div>
  )
}

export function ObjectEditorTab({ tab, isActive = true }: ObjectEditorTabProps) {
  const { id: tabId, connectionId, databaseName, objectName, objectType, mode } = tab

  // Object editor store selectors
  const tabState = useObjectEditorStore((state) => state.tabs[tabId])
  const initTab = useObjectEditorStore((state) => state.initTab)
  const loadBody = useObjectEditorStore((state) => state.loadBody)
  const saveBody = useObjectEditorStore((state) => state.saveBody)
  const setContent = useObjectEditorStore((state) => state.setContent)

  // Workspace store
  const updateObjectEditorTab = useWorkspaceStore((state) => state.updateObjectEditorTab)
  const setBlockingNavigation = useWorkspaceStore((state) => state.setBlockingNavigation)

  const { content, isLoading, isSaving, error, isDirty, pendingNavigationAction, ...view } =
    deriveObjectEditorView(tabState, mode)

  // Initialize tab and load body on mount
  useEffect(() => {
    const existing = useObjectEditorStore.getState().tabs[tabId]
    if (!existing) {
      initTab(tabId, {
        connectionId: connectionId,
        database: databaseName,
        objectName: objectName,
        objectType: objectType,
        mode: mode,
      })
      void loadBody(tabId)
    }
  }, [tabId, connectionId, databaseName, objectName, objectType, mode, initTab, loadBody])

  // Save handler with create→alter transition
  const performSave = useCallback(async () => {
    const storeTab = useObjectEditorStore.getState().tabs[tabId]
    const wasCreateMode = storeTab?.mode === 'create'

    await saveBody(tabId)

    if (wasCreateMode) {
      const savedName = useObjectEditorStore.getState().consumeSavedObjectName(tabId)
      if (savedName) {
        const typeLabel = OBJECT_TYPE_LABELS[objectType]
        updateObjectEditorTab(tabId, {
          objectName: savedName,
          mode: 'alter',
          label: `${typeLabel}: ${savedName}`,
        })
      }
    }
  }, [tabId, objectType, saveBody, updateObjectEditorTab])

  // Content change handler for Monaco
  const handleContentChange = useCallback(
    (value: string) => {
      setContent(tabId, value)
    },
    [tabId, setContent]
  )

  // Unsaved changes dialog handlers
  const handleSaveNavigation = useCallback(async () => {
    await performSave()
    // Only proceed with navigation if save succeeded (no longer dirty)
    if (!useObjectEditorStore.getState().isDirty(tabId)) {
      useObjectEditorStore.getState().clearPendingAction(tabId)
    }
  }, [tabId, performSave])

  const handleDiscardNavigation = useCallback(() => {
    const currentTabState = useObjectEditorStore.getState().tabs[tabId]
    if (currentTabState) {
      useObjectEditorStore.getState().setContent(tabId, currentTabState.originalContent)
    }
    useObjectEditorStore.getState().clearPendingAction(tabId)
  }, [tabId])

  const handleCancelNavigation = useCallback(() => {
    useObjectEditorStore.getState().cancelPendingAction(tabId)
  }, [tabId])

  useEffect(() => {
    setBlockingNavigation(tabId, pendingNavigationAction !== null)
    return () => setBlockingNavigation(tabId, false)
  }, [pendingNavigationAction, setBlockingNavigation, tabId])

  useEffect(() => {
    if (isActive) return
    if (pendingNavigationAction !== null) {
      useObjectEditorStore.getState().cancelPendingAction(tabId)
    }
  }, [isActive, pendingNavigationAction, tabId])

  const isInitialLoad = isLoading && !error
  if (isInitialLoad) {
    return (
      <ObjectEditorStatusView stateClassName={styles.loadingState} testId="object-editor-loading">
        <div className={styles.spinner} aria-hidden />
        <span>Loading...</span>
      </ObjectEditorStatusView>
    )
  }

  // Fatal error state — only when there is NO content (i.e. load failure).
  // Save failures set `error` too but the editor must remain visible so the
  // user can correct the DDL and retry.  Save errors are surfaced via toast.
  const isLoadFailure = Boolean(error) && !content
  if (isLoadFailure) {
    return (
      <ObjectEditorStatusView stateClassName={styles.errorState} testId="object-editor-error">
        {error}
      </ObjectEditorStatusView>
    )
  }

  return (
    <div className={styles.container} data-testid="object-editor-tab">
      <ObjectEditorToolbar
        objectType={objectType}
        objectName={objectName}
        databaseName={databaseName}
        mode={view.mode}
        isSaving={isSaving}
        isDirty={isDirty}
        onSave={() => void performSave()}
      />
      <div className={styles.editorArea}>
        <MonacoEditorWrapper
          tabId={tabId}
          connectionId={connectionId}
          tabType="object-editor"
          value={content}
          onChange={handleContentChange}
          readOnly={isSaving}
        />
      </div>

      {pendingNavigationAction !== null && (
        <UnsavedChangesDialog
          tabId={tabId}
          onSave={handleSaveNavigation}
          onDiscard={handleDiscardNavigation}
          onCancel={handleCancelNavigation}
          title="Unsaved changes"
          message="You have unsaved DDL changes. What would you like to do?"
          saveLabel="Save"
        />
      )}
    </div>
  )
}

export default ObjectEditorTab
