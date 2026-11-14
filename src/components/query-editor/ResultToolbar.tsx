import { useCallback, useMemo } from 'react'
import { countRanges, useQueryStore, getActiveResult } from '../../stores/query-store'
import { EditModeDropdown } from './EditModeDropdown'
import { ViewModeGroup } from '../shared/toolbar/ViewModeGroup'
import { ExportButton } from '../shared/toolbar/ExportButton'
import { CopySelectedRowsButton } from '../shared/toolbar/CopySelectedRowsButton'
import { FilterToolbarButton } from '../shared/FilterToolbarButton'
import type { ViewMode } from '../../types/shared-data-view'
import type { FilterCondition } from '../../types/schema'
import styles from './ResultToolbar.module.css'
import {
  editTableNameOf,
  isCopySelectedDisabled,
  sortedCheckedRanges,
  type ActiveResult,
} from './result-toolbar/result-toolbar-model'
import {
  DeleteRowsConfirmDialog,
  ResultEditActionGroups,
} from './result-toolbar/ResultToolbarParts'
import { ResultToolbarStatus } from './result-toolbar/ResultToolbarStatus'
import { useCopySelectedRows } from './result-toolbar/use-copy-selected-rows'
import { useDeleteCheckedRows } from './result-toolbar/use-delete-checked-rows'

interface ResultToolbarProps {
  tabId: string
  connectionId: string
  filterModel: FilterCondition[]
  onFilterClick: () => void
  onClearFilterClick: () => void
  isEditingActive?: boolean
  isCloneVisible?: boolean
  isCloneDisabled?: boolean
}

function useResultRowEditActions(tabId: string) {
  const setViewMode = useQueryStore((state) => state.setViewMode)
  const openExportDialog = useQueryStore((state) => state.openExportDialog)
  const cloneSelectedRow = useQueryStore((state) => state.cloneSelectedRow)
  const saveCurrentRow = useQueryStore((state) => state.saveCurrentRow)
  const discardCurrentRow = useQueryStore((state) => state.discardCurrentRow)
  return {
    handleViewMode: useCallback((mode: ViewMode) => setViewMode(tabId, mode), [setViewMode, tabId]),
    handleExport: useCallback(() => openExportDialog(tabId), [openExportDialog, tabId]),
    handleSave: useCallback(() => {
      saveCurrentRow(tabId)
    }, [saveCurrentRow, tabId]),
    handleClone: useCallback(() => cloneSelectedRow(tabId), [cloneSelectedRow, tabId]),
    handleDiscard: useCallback(() => discardCurrentRow(tabId), [discardCurrentRow, tabId]),
  }
}

function useCheckedRowActions(tabId: string, activeResult: ActiveResult) {
  const activeResultIndex = useQueryStore((state) => state.tabs[tabId]?.activeResultIndex ?? 0)
  const checkedRanges = useMemo(() => sortedCheckedRanges(activeResult), [activeResult])
  const checkedCount = countRanges(checkedRanges)
  const handleCopySelectedRows = useCopySelectedRows({
    tabId: tabId,
    activeResultIndex: activeResultIndex,
    columns: activeResult.columns,
    checkedRanges: checkedRanges,
  })
  const deletion = useDeleteCheckedRows(tabId, checkedCount, editTableNameOf(activeResult))
  return { checkedCount, handleCopySelectedRows, deletion }
}

export function ResultToolbar({
  tabId,
  connectionId,
  filterModel,
  onFilterClick,
  onClearFilterClick,
  isEditingActive = false,
  isCloneVisible = false,
  isCloneDisabled = true,
}: ResultToolbarProps) {
  const activeResult = useQueryStore((state) => getActiveResult(state.tabs[tabId]))
  const actions = useResultRowEditActions(tabId)
  const { checkedCount, handleCopySelectedRows, deletion } = useCheckedRowActions(
    tabId,
    activeResult
  )
  const hasResults = activeResult.resultStatus === 'success'
  const isFilterDisabled = activeResult.columns.length === 0 || isEditingActive

  return (
    <div className={styles.toolbar} data-testid="result-toolbar">
      <ViewModeGroup
        currentMode={activeResult.viewMode}
        availableModes={['grid', 'form', 'text']}
        onModeChange={actions.handleViewMode}
        testIdPrefix="view-mode"
      />
      <EditModeDropdown tabId={tabId} connectionId={connectionId} />
      <ResultEditActionGroups
        result={activeResult}
        checkedCount={checkedCount}
        clone={{
          isVisible: isCloneVisible,
          isDisabled: isCloneDisabled,
          onClone: actions.handleClone,
        }}
        onDelete={deletion.handleDeleteChecked}
        onSave={actions.handleSave}
        onDiscard={actions.handleDiscard}
      />
      <ResultToolbarStatus tabId={tabId} result={activeResult} filterModel={filterModel} />
      <FilterToolbarButton
        isActive={filterModel.length > 0}
        activeCount={filterModel.length}
        onFilterClick={onFilterClick}
        onClearClick={onClearFilterClick}
        isDisabled={isFilterDisabled}
      />
      <ExportButton disabled={!hasResults} onClick={actions.handleExport} testId="export-button" />
      <CopySelectedRowsButton
        disabled={isCopySelectedDisabled({
          hasResults: hasResults,
          checkedCount: checkedCount,
          isRowActionPending: activeResult.rowActionProgress !== null,
        })}
        onClick={() => void handleCopySelectedRows()}
      />
      <DeleteRowsConfirmDialog deletion={deletion} />
    </div>
  )
}
