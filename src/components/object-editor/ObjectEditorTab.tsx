import { useCallback, useEffect } from 'react'
import { useObjectEditorStore } from '../../stores/object-editor-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import type { ObjectEditorTab as ObjectEditorTabType } from '../../types/schema'
import { MonacoEditorWrapper } from '../query-editor/MonacoEditorWrapper'
import { UnsavedChangesDialog } from '../shared/UnsavedChangesDialog'
import { ObjectEditorToolbar, OBJECT_TYPE_LABELS } from './ObjectEditorToolbar'
import styles from './ObjectEditorTab.module.css'

interface ObjectEditorTabProps {
  tab: ObjectEditorTabType
}

export function ObjectEditorTab({ tab }: ObjectEditorTabProps) {
  const { id: tabId, connectionId, databaseName, objectName, objectType, mode } = tab

  // Object editor store selectors
  const tabState = useObjectEditorStore((state) => state.tabs[tabId])
  const initTab = useObjectEditorStore((state) => state.initTab)
  const loadBody = useObjectEditorStore((state) => state.loadBody)
  const saveBody = useObjectEditorStore((state) => state.saveBody)
  const setContent = useObjectEditorStore((state) => state.setContent)

  // Workspace store
  const updateObjectEditorTab = useWorkspaceStore((state) => state.updateObjectEditorTab)

  // Derived state
  const content = tabState?.content ?? ''
  const isLoading = tabState?.isLoading ?? mode === 'alter'
  const isSaving = tabState?.isSaving ?? false
  const error = tabState?.error ?? null
  const isDirty = tabState ? tabState.content !== tabState.originalContent : false
  const pendingNavigationAction = tabState?.pendingNavigationAction ?? null

  // Initialize tab and load body on mount
  useEffect(() => {
    const existing = useObjectEditorStore.getState().tabs[tabId]
    if (!existing) {
      initTab(tabId, {
        connectionId,
        database: databaseName,
        objectName,
        objectType,
        mode,
      })
      void loadBody(tabId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, connectionId, databaseName, objectName, objectType, mode])

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

  // Loading state
  if (isLoading && !error) {
    return (
      <div className={styles.container} data-testid="object-editor-tab">
        <div className={styles.loadingState} data-testid="object-editor-loading">
          <div className={styles.spinner} aria-hidden />
          <span>Loading...</span>
        </div>
      </div>
    )
  }

  // Fatal error state — only when there is NO content (i.e. load failure).
  // Save failures set `error` too but the editor must remain visible so the
  // user can correct the DDL and retry.  Save errors are surfaced via toast.
  if (error && !content) {
    return (
      <div className={styles.container} data-testid="object-editor-tab">
        <div className={styles.errorState} data-testid="object-editor-error">
          {error}
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container} data-testid="object-editor-tab">
      <ObjectEditorToolbar
        objectType={objectType}
        objectName={objectName}
        databaseName={databaseName}
        mode={tabState?.mode ?? mode}
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
          title="Unsaved Changes"
          message="You have unsaved DDL changes. What would you like to do?"
          saveLabel="Save"
        />
      )}
    </div>
  )
}
