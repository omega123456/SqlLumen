import { useCallback, useEffect, type ReactNode } from 'react'
import { useObjectEditorStore, type ObjectEditorTabState } from '../../stores/object-editor-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import type { ObjectEditorTab as ObjectEditorTabType } from '../../types/schema'
import { joinClassNames } from '../../lib/class-names'
import { MonacoEditorWrapper } from '../query-editor/MonacoEditorWrapper'
import { UnsavedChangesDialog } from '../shared/UnsavedChangesDialog'
import { ObjectEditorToolbar } from './ObjectEditorToolbar'
import { OBJECT_TYPE_LABELS } from './object-editor-constants'

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

type ObjectEditorStatusTone = 'loading' | 'error'

const STATUS_TONE_CLASSES: Record<ObjectEditorStatusTone, string> = {
  loading: 'flex-col gap-2 text-light-on-surface-variant dark:text-dark-on-surface-variant',
  error: 'p-6 text-light-error dark:text-dark-error',
}

interface ObjectEditorStatusViewProps {
  tone: ObjectEditorStatusTone
  testId: string
  children: ReactNode
}

function ObjectEditorFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden" data-testid="object-editor-tab">
      {children}
    </div>
  )
}

function ObjectEditorStatusView({ tone, testId, children }: ObjectEditorStatusViewProps) {
  return (
    <ObjectEditorFrame>
      <div
        className={joinClassNames([
          'flex min-h-60 flex-1 items-center justify-center',
          STATUS_TONE_CLASSES[tone],
        ])}
        data-testid={testId}
      >
        {children}
      </div>
    </ObjectEditorFrame>
  )
}

function useObjectEditorInitialLoad(tab: ObjectEditorTabType): void {
  const { id: tabId, connectionId, databaseName, objectName, objectType, mode } = tab
  const initTab = useObjectEditorStore((state) => state.initTab)
  const loadBody = useObjectEditorStore((state) => state.loadBody)

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
}

function useObjectEditorSave(tabId: string, objectType: ObjectEditorTabType['objectType']) {
  const saveBody = useObjectEditorStore((state) => state.saveBody)
  const updateObjectEditorTab = useWorkspaceStore((state) => state.updateObjectEditorTab)

  return useCallback(async () => {
    const storeTab = useObjectEditorStore.getState().tabs[tabId]
    const wasCreateMode = storeTab?.mode === 'create'

    await saveBody(tabId)

    if (!wasCreateMode) return
    const savedName = useObjectEditorStore.getState().consumeSavedObjectName(tabId)
    if (!savedName) return
    const typeLabel = OBJECT_TYPE_LABELS[objectType]
    updateObjectEditorTab(tabId, {
      objectName: savedName,
      mode: 'alter',
      label: `${typeLabel}: ${savedName}`,
    })
  }, [tabId, objectType, saveBody, updateObjectEditorTab])
}

function usePendingNavigationHandlers(tabId: string, performSave: () => Promise<void>) {
  const handleSaveNavigation = useCallback(async () => {
    await performSave()
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

  return { handleSaveNavigation, handleDiscardNavigation, handleCancelNavigation }
}

type PendingNavigationAction = ReturnType<typeof deriveObjectEditorView>['pendingNavigationAction']

interface PendingNavigationGuardInput {
  tabId: string
  isActive: boolean
  pendingNavigationAction: PendingNavigationAction
}

function usePendingNavigationGuard({
  tabId,
  isActive,
  pendingNavigationAction,
}: PendingNavigationGuardInput): void {
  const setBlockingNavigation = useWorkspaceStore((state) => state.setBlockingNavigation)

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
}

interface PendingNavigationDialogProps {
  tabId: string
  performSave: () => Promise<void>
}

function PendingNavigationDialog({ tabId, performSave }: PendingNavigationDialogProps) {
  const navigation = usePendingNavigationHandlers(tabId, performSave)
  return (
    <UnsavedChangesDialog
      tabId={tabId}
      onSave={navigation.handleSaveNavigation}
      onDiscard={navigation.handleDiscardNavigation}
      onCancel={navigation.handleCancelNavigation}
      title="Unsaved changes"
      message="You have unsaved DDL changes. What would you like to do?"
      saveLabel="Save"
    />
  )
}

export function ObjectEditorTab({ tab, isActive = true }: ObjectEditorTabProps) {
  const { id: tabId, connectionId, databaseName, objectName, objectType, mode } = tab
  const tabState = useObjectEditorStore((state) => state.tabs[tabId])
  const setContent = useObjectEditorStore((state) => state.setContent)
  const { content, isLoading, isSaving, error, isDirty, pendingNavigationAction, ...view } =
    deriveObjectEditorView(tabState, mode)

  useObjectEditorInitialLoad(tab)
  const performSave = useObjectEditorSave(tabId, objectType)
  usePendingNavigationGuard({
    tabId: tabId,
    isActive: isActive,
    pendingNavigationAction: pendingNavigationAction,
  })

  const isInitialLoad = isLoading && !error
  if (isInitialLoad) {
    return (
      <ObjectEditorStatusView tone="loading" testId="object-editor-loading">
        <div
          className="size-6 animate-spin-850ms rounded-round border-2 border-light-stroke-card border-t-light-primary window-blurred:animate-spin-850ms-paused dark:border-dark-stroke-card dark:border-t-dark-primary"
          aria-hidden
        />
        <span>Loading...</span>
      </ObjectEditorStatusView>
    )
  }

  const isLoadFailure = Boolean(error) && !content
  if (isLoadFailure) {
    return (
      <ObjectEditorStatusView tone="error" testId="object-editor-error">
        {error}
      </ObjectEditorStatusView>
    )
  }

  return (
    <ObjectEditorFrame>
      <ObjectEditorToolbar
        objectType={objectType}
        objectName={objectName}
        databaseName={databaseName}
        mode={view.mode}
        isSaving={isSaving}
        isDirty={isDirty}
        onSave={() => void performSave()}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        <MonacoEditorWrapper
          tabId={tabId}
          connectionId={connectionId}
          tabType="object-editor"
          value={content}
          onChange={(value) => setContent(tabId, value)}
          readOnly={isSaving}
        />
      </div>

      {pendingNavigationAction !== null && (
        <PendingNavigationDialog tabId={tabId} performSave={performSave} />
      )}
    </ObjectEditorFrame>
  )
}

export default ObjectEditorTab
