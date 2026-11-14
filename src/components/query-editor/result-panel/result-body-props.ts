import type { ResultBodyProps } from './ResultBodies'
import {
  gridTabPanelClassNameFor,
  isCloneDisabled,
  readEditTable,
  resultTabPanelAttributes,
  subTabLabelledBy,
  type DisplayStatus,
} from './result-panel-model'
import type { ResultPanelControllers } from './use-result-panel-controllers'

export interface ResultPanelLocation {
  tabId: string
  connectionId: string
  isActive: boolean
  hideSubTabs: boolean
}

interface ResultBodyInputs {
  location: ResultPanelLocation
  controllers: ResultPanelControllers
  displayStatus: DisplayStatus
  isTabRunning: boolean
}

function resolveTabPanelAttributes(
  location: ResultPanelLocation,
  activeResultIndex: number,
  showsSubTabs: boolean
) {
  const { tabId, hideSubTabs } = location
  const panelId = `result-tabpanel-${tabId}-${activeResultIndex}`
  const labelledBy = subTabLabelledBy(showsSubTabs, tabId, activeResultIndex)
  return resultTabPanelAttributes(hideSubTabs, panelId, labelledBy)
}

function resolveToolbarProps(inputs: ResultBodyInputs): ResultBodyProps['toolbar'] {
  const { location, controllers, displayStatus } = inputs
  const { activeResult: result, filter } = controllers
  const { primaryKey, editTableColumns } = readEditTable(result)
  return {
    tabId: location.tabId,
    connectionId: location.connectionId,
    filterModel: result.filterModel,
    onFilterClick: filter.openFilterDialog,
    onClearFilterClick: filter.clearFilter,
    isEditingActive: result.editState !== null,
    isCloneVisible: result.editMode !== null,
    isCloneDisabled: isCloneDisabled({
      result: result,
      displayStatus: displayStatus,
      editTableColumns: editTableColumns,
      primaryKey: primaryKey,
    }),
  }
}

export function buildResultBodyProps(
  inputs: ResultBodyInputs,
  showsSubTabs: boolean
): ResultBodyProps {
  const { location, controllers, displayStatus } = inputs
  const { activeResult: result, activeResultIndex } = controllers
  return {
    tabPanelAttributes: resolveTabPanelAttributes(location, activeResultIndex, showsSubTabs),
    className: gridTabPanelClassNameFor(result.viewMode, result.columns.length),
    displayStatus: displayStatus,
    toolbar: resolveToolbarProps(inputs),
    views: {
      tabId: location.tabId,
      activeResultIndex: activeResultIndex,
      result: result,
      editTableColumns: readEditTable(result).editTableColumns,
      handlers: controllers.viewHandlers,
      isActive: location.isActive,
    },
    isTabRunning: inputs.isTabRunning,
    onForeignKeyLookup: controllers.foreignKeyLookup.openLookup,
  }
}
