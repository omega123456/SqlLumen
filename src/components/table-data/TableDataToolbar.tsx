import { useCallback } from 'react'
import { useTableDataStore } from '../../stores/table-data-store'
import { useConnectionStore } from '../../stores/connection-store'
import { StatusArea } from '../shared/toolbar/StatusArea'
import styles from './TableDataToolbar.module.css'
import {
  deleteCopyFor,
  deleteTargetCountFor,
  isNoKeyBadgeVisible,
  positiveOrUndefined,
  rowActionAvailability,
  toolbarTabView,
} from './table-data-toolbar/toolbar-model'
import {
  LoadControlButton,
  RestoringStatusHint,
  RowActionButtons,
  ToolbarBadges,
} from './table-data-toolbar/ToolbarParts'
import { ToolbarDialogs, ToolbarRightSection } from './table-data-toolbar/ToolbarRightSection'
import {
  useCopyCheckedRows,
  useToolbarFilter,
  useToolbarPaging,
  useToolbarViewActions,
} from './table-data-toolbar/use-toolbar-navigation'
import {
  useToolbarDeletion,
  useToolbarRowEdits,
} from './table-data-toolbar/use-toolbar-row-actions'

interface TableDataToolbarProps {
  tabId: string
  isView?: boolean
}

function useToolbarState(tabId: string) {
  const tabState = useTableDataStore((state) => state.tabs[tabId])
  const requestNavigationAction = useTableDataStore((state) => state.requestNavigationAction)
  const view = toolbarTabView(tabState)
  const isConnectionReadOnly = useConnectionStore(
    (state) => state.activeConnections[view.connectionId]?.profile?.readOnly ?? false
  )
  const withNavigationGuard = useCallback(
    (action: () => void) => requestNavigationAction(tabId, action),
    [tabId, requestNavigationAction]
  )
  const isBusy = view.isLoading || view.isRestoring
  const deleteTargetCount = deleteTargetCountFor(view.checkedRowKeys.length, view.selectedRowKey)
  const availability = rowActionAvailability({
    view: view,
    isConnectionReadOnly: isConnectionReadOnly,
    isBusy: isBusy,
    deleteTargetCount: deleteTargetCount,
  })
  return {
    view: view,
    isConnectionReadOnly: isConnectionReadOnly,
    withNavigationGuard: withNavigationGuard,
    isBusy: isBusy,
    deleteTargetCount: deleteTargetCount,
    deleteCopy: deleteCopyFor(deleteTargetCount),
    availability: availability,
  }
}

export function TableDataToolbar({ tabId, isView = false }: TableDataToolbarProps) {
  const toolbar = useToolbarState(tabId)
  const { view, isConnectionReadOnly, isBusy, deleteTargetCount, deleteCopy } = toolbar
  const actionInputs = {
    tabId: tabId,
    view: view,
    withNavigationGuard: toolbar.withNavigationGuard,
  }
  const deletion = useToolbarDeletion(actionInputs, deleteTargetCount)
  const rowEdits = useToolbarRowEdits(actionInputs)
  const viewActions = useToolbarViewActions(actionInputs)
  const filter = useToolbarFilter(actionInputs)
  const paging = useToolbarPaging(actionInputs)
  const handleCopySelectedRows = useCopyCheckedRows(view)

  return (
    <div className={styles.toolbar} data-testid="table-data-toolbar">
      <div className={styles.leftSection}>
        <StatusArea
          status={isBusy ? 'loading' : 'success'}
          executionTimeMs={positiveOrUndefined(view.executionTimeMs)}
          customContent={<RestoringStatusHint isRestoring={view.isRestoring} />}
        />
        <ToolbarBadges
          isView={isView}
          isConnectionReadOnly={isConnectionReadOnly}
          showNoKeyBadge={isNoKeyBadgeVisible(isView, view)}
        />
        <div className={styles.divider} />
        {!isView && (
          <RowActionButtons
            availability={toolbar.availability}
            deleteCopy={deleteCopy}
            handlers={{ ...rowEdits, onDelete: deletion.handleDeleteRow }}
          />
        )}
        <LoadControlButton
          view={view}
          isBusy={isBusy}
          onCancelLoad={viewActions.handleCancelLoad}
          onRefresh={viewActions.handleRefresh}
        />
      </div>
      <ToolbarRightSection
        view={view}
        isBusy={isBusy}
        filter={filter}
        viewActions={viewActions}
        paging={paging}
        onCopySelectedRows={handleCopySelectedRows}
      />
      <ToolbarDialogs view={view} deleteCopy={deleteCopy} deletion={deletion} filter={filter} />
    </div>
  )
}
