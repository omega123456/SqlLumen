import { useCallback, useMemo } from 'react'
import { countRanges, useQueryStore, getActiveResult } from '../../stores/query-store'
import { EditModeDropdown } from './EditModeDropdown'
import { ViewModeGroup } from '../shared/toolbar/ViewModeGroup'
import { DataActionButtons } from '../shared/toolbar/DataActionButtons'
import { DataViewToolbar } from '../shared/toolbar/DataViewToolbar'
import type { ViewMode } from '../../types/shared-data-view'
import type { FilterCondition } from '../../types/schema'
import { RowActionButtons } from '../shared/toolbar/row-actions/RowActionButtons'
import { DeleteRowsConfirmDialog } from '../shared/toolbar/row-actions/DeleteRowsConfirmDialog'
import {
  isCopySelectedDisabled,
  sortedCheckedRanges,
  type ActiveResult,
} from './result-toolbar/result-toolbar-model'
import { NO_ROW_INSERTION, type ResultRowInsertion } from './result-panel/result-panel-model'
import { useCopySelectedRows } from './result-toolbar/use-copy-selected-rows'
import { useResultRowActions } from './result-toolbar/use-result-row-actions'

interface ResultToolbarProps {
  tabId: string
  connectionId: string
  filterModel: FilterCondition[]
  onFilterClick: () => void
  onClearFilterClick: () => void
  isEditingActive?: boolean
  rowInsertion?: ResultRowInsertion
}

function useResultViewActions(tabId: string) {
  const setViewMode = useQueryStore((state) => state.setViewMode)
  const openExportDialog = useQueryStore((state) => state.openExportDialog)
  return {
    handleViewMode: useCallback((mode: ViewMode) => setViewMode(tabId, mode), [setViewMode, tabId]),
    handleExport: useCallback(() => openExportDialog(tabId), [openExportDialog, tabId]),
  }
}

function useCheckedRowCopy(tabId: string, activeResult: ActiveResult) {
  const activeResultIndex = useQueryStore((state) => state.tabs[tabId]?.activeResultIndex ?? 0)
  const checkedRanges = useMemo(() => sortedCheckedRanges(activeResult), [activeResult])
  const checkedCount = countRanges(checkedRanges)
  const handleCopySelectedRows = useCopySelectedRows({
    tabId: tabId,
    activeResultIndex: activeResultIndex,
    columns: activeResult.columns,
    checkedRanges: checkedRanges,
  })
  return { checkedCount, handleCopySelectedRows }
}

interface ResultDataActionsProps {
  filterModel: FilterCondition[]
  onFilterClick: () => void
  onClearFilterClick: () => void
  isFilterDisabled: boolean
  hasResults: boolean
  isCopySelectedDisabled: boolean
  onExport: () => void
  onCopySelectedRows: () => void
}

function ResultDataActions(props: ResultDataActionsProps) {
  const { filterModel } = props
  return (
    <DataActionButtons
      filter={{
        isActive: filterModel.length > 0,
        activeCount: filterModel.length,
        onFilterClick: props.onFilterClick,
        onClearClick: props.onClearFilterClick,
        isDisabled: props.isFilterDisabled,
      }}
      exportAction={{
        disabled: !props.hasResults,
        onClick: props.onExport,
        testId: 'export-button',
      }}
      copySelected={{
        disabled: props.isCopySelectedDisabled,
        onClick: props.onCopySelectedRows,
      }}
    />
  )
}

export function ResultToolbar({
  tabId,
  connectionId,
  filterModel,
  onFilterClick,
  onClearFilterClick,
  isEditingActive = false,
  rowInsertion = NO_ROW_INSERTION,
}: ResultToolbarProps) {
  const activeResult = useQueryStore((state) => getActiveResult(state.tabs[tabId]))
  const actions = useResultViewActions(tabId)
  const { checkedCount, handleCopySelectedRows } = useCheckedRowCopy(tabId, activeResult)
  const rowActions = useResultRowActions({
    tabId: tabId,
    connectionId: connectionId,
    result: activeResult,
    checkedCount: checkedCount,
    rowInsertion: rowInsertion,
  })
  const hasResults = activeResult.resultStatus === 'success'

  return (
    <DataViewToolbar
      testId="result-toolbar"
      viewMode={
        <ViewModeGroup
          currentMode={activeResult.viewMode}
          availableModes={['grid', 'form', 'text']}
          onModeChange={actions.handleViewMode}
          testIdPrefix="view-mode"
        />
      }
      editTarget={<EditModeDropdown tabId={tabId} connectionId={connectionId} />}
      rowActions={
        <RowActionButtons
          availability={rowActions.availability}
          deleteButton={rowActions.deleteButton}
          handlers={rowActions.handlers}
        />
      }
      dataActions={
        <ResultDataActions
          filterModel={filterModel}
          onFilterClick={onFilterClick}
          onClearFilterClick={onClearFilterClick}
          isFilterDisabled={activeResult.columns.length === 0 || isEditingActive}
          hasResults={hasResults}
          isCopySelectedDisabled={isCopySelectedDisabled({
            hasResults: hasResults,
            checkedCount: checkedCount,
            isRowActionPending: activeResult.rowActionProgress !== null,
          })}
          onExport={actions.handleExport}
          onCopySelectedRows={() => void handleCopySelectedRows()}
        />
      }
      dialogs={<DeleteRowsConfirmDialog deletion={rowActions.deletion} />}
    />
  )
}
