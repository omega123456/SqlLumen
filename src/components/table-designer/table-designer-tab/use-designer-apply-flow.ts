import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { logFrontendError } from '../../../lib/app-log-commands'
import { toErrorMessage } from '../../../lib/error-message'
import { invalidateSchemaIndex } from '../../../lib/schema-index-commands'
import { useSchemaStore } from '../../../stores/schema-store'
import { useTableDesignerStore } from '../../../stores/table-designer-store'
import { showErrorToast } from '../../../stores/toast-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import type { TableDesignerTab as TableDesignerTabType } from '../../../types/schema'
import { clearPendingNavigationAction } from './designer-tab-view'

type PostApplyAction = (() => void) | null
type PostApplyActionRef = RefObject<PostApplyAction>

interface ApplyFlowInput {
  tab: TableDesignerTabType
  isActive: boolean
}

function latestTabState(tabId: string) {
  return useTableDesignerStore.getState().tabs[tabId]
}

function pendingNavigationActionOf(tabId: string): PostApplyAction {
  return latestTabState(tabId)?.pendingNavigationAction ?? null
}

function setPostApplyAction(actionRef: PostApplyActionRef, action: PostApplyAction): void {
  actionRef.current = action
}

function takePostApplyAction(actionRef: PostApplyActionRef): PostApplyAction {
  const action = actionRef.current
  actionRef.current = null
  return action
}

function invalidateTableSchemaIndex(connectionId: string, qualifiedName: string): void {
  invalidateSchemaIndex(connectionId, [qualifiedName]).catch((error) => {
    const message = toErrorMessage(error)
    logFrontendError('[table-designer] Schema index invalidation failed:', message)
  })
}

function useApplyDialogOpenState(isActive: boolean) {
  const [isApplyDialogOpen, setIsApplyDialogOpen] = useState(false)
  const [previousIsActive, setPreviousIsActive] = useState(isActive)
  const hasBecomeInactive = previousIsActive && !isActive
  if (previousIsActive !== isActive) {
    setPreviousIsActive(isActive)
  }
  if (hasBecomeInactive) {
    setIsApplyDialogOpen(false)
  }
  return { isApplyDialogOpen, setIsApplyDialogOpen }
}

function usePrepareApplyDialog(
  tabId: string,
  postApplyActionRef: PostApplyActionRef,
  openApplyDialog: () => void
) {
  const regenerateDdl = useTableDesignerStore((state) => state.regenerateDdl)
  return useCallback(
    async (postApplyAction: PostApplyAction = null) => {
      setPostApplyAction(postApplyActionRef, postApplyAction)
      await regenerateDdl(tabId)

      const latest = latestTabState(tabId)
      if (!latest) {
        setPostApplyAction(postApplyActionRef, null)
        return
      }

      if (latest.ddlError) {
        showErrorToast('Failed to prepare schema changes', latest.ddlError)
        setPostApplyAction(postApplyActionRef, null)
        return
      }

      openApplyDialog()
    },
    [openApplyDialog, postApplyActionRef, regenerateDdl, tabId]
  )
}

function useApplySuccess(tab: TableDesignerTabType, postApplyActionRef: PostApplyActionRef) {
  const { id: tabId, connectionId, databaseName } = tab
  const loadSchema = useTableDesignerStore((state) => state.loadSchema)
  const updateTabContext = useTableDesignerStore((state) => state.updateTabContext)
  const refreshCategory = useSchemaStore((state) => state.refreshCategory)
  const updateWorkspaceDesignerTab = useWorkspaceStore((state) => state.updateTableDesignerTab)
  return useCallback(async () => {
    const latest = latestTabState(tabId)
    if (!latest) {
      setPostApplyAction(postApplyActionRef, null)
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
    invalidateTableSchemaIndex(connectionId, `${databaseName}.${latestTableName}`)
    const action = takePostApplyAction(postApplyActionRef)
    if (!action) return
    clearPendingNavigationAction(tabId)
    action()
  }, [
    connectionId,
    databaseName,
    loadSchema,
    postApplyActionRef,
    refreshCategory,
    tabId,
    updateTabContext,
    updateWorkspaceDesignerTab,
  ])
}

function useNavigationGuardHandlers(
  tabId: string,
  prepareApplyDialog: (action: PostApplyAction) => Promise<void>
) {
  const discardChanges = useTableDesignerStore((state) => state.discardChanges)

  const handleSaveNavigation = useCallback(async () => {
    await prepareApplyDialog(pendingNavigationActionOf(tabId))
  }, [prepareApplyDialog, tabId])

  const handleDiscardNavigation = useCallback(() => {
    const action = pendingNavigationActionOf(tabId)
    discardChanges(tabId)
    clearPendingNavigationAction(tabId)
    action?.()
  }, [discardChanges, tabId])

  const handleCancelNavigation = useCallback(() => {
    clearPendingNavigationAction(tabId)
  }, [tabId])

  return { handleSaveNavigation, handleDiscardNavigation, handleCancelNavigation }
}

export function useDesignerApplyFlow({ tab, isActive }: ApplyFlowInput) {
  const tabId = tab.id
  const { isApplyDialogOpen, setIsApplyDialogOpen } = useApplyDialogOpenState(isActive)
  const postApplyActionRef = useRef<PostApplyAction>(null)
  const openApplyDialog = useCallback(() => setIsApplyDialogOpen(true), [setIsApplyDialogOpen])
  const prepareApplyDialog = usePrepareApplyDialog(tabId, postApplyActionRef, openApplyDialog)
  const applySucceeded = useApplySuccess(tab, postApplyActionRef)
  const navigation = useNavigationGuardHandlers(tabId, prepareApplyDialog)

  const handleApplySuccess = useCallback(async () => {
    setIsApplyDialogOpen(false)
    await applySucceeded()
  }, [applySucceeded, setIsApplyDialogOpen])

  const handleApplyCancel = useCallback(() => {
    setIsApplyDialogOpen(false)
    postApplyActionRef.current = null
  }, [setIsApplyDialogOpen])

  useEffect(() => {
    if (isActive) return
    postApplyActionRef.current = null
  }, [isActive])

  return {
    isApplyDialogOpen,
    prepareApplyDialog,
    handleApplySuccess,
    handleApplyCancel,
    ...navigation,
  }
}
