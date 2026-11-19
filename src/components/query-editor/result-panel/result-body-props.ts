import type { ResultBodyProps } from './ResultBodies'
import {
  gridTabPanelClassNameFor,
  readEditTable,
  resultRowInsertion,
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
    surfaceRef: controllers.surfaceRef,
    connectionId: location.connectionId,
    filterModel: result.view.spec.filters,
    onFilterClick: filter.openFilterDialog,
    onClearFilterClick: filter.clearFilter,
    isEditingActive: result.view.edit.state !== null,
    rowInsertion: resultRowInsertion({
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
    className: gridTabPanelClassNameFor(result.view.mode, result.view.slot.columns.length),
    displayStatus: displayStatus,
    toolbar: resolveToolbarProps(inputs),
    views: { source: controllers.source, mode: result.view.mode },
    tabId: location.tabId,
    result: result,
    isTabRunning: inputs.isTabRunning,
  }
}
