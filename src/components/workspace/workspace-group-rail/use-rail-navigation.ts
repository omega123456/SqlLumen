import { useRef, type KeyboardEvent } from 'react'
import type { WorkspaceTab } from '../../../types/schema'
import type { WorkspaceTabStackKey } from '../../../lib/workspace-tab-stacks'
import { useObjectEditorStore } from '../../../stores/object-editor-store'
import { useTableDesignerStore } from '../../../stores/table-designer-store'
import { RAIL_NAVIGATION_TARGETS, type RailKey } from './group-rail-model'
import type { RailItemHandlers } from './RailItems'
import type { RailTooltipControls } from './use-rail-item-layout'

export function useIsTabDirty(): (tab: WorkspaceTab) => boolean {
  const designerTabs = useTableDesignerStore((state) => state.tabs)
  const objectEditorTabs = useObjectEditorStore((state) => state.tabs)
  return (tab) => {
    if (tab.type === 'table-designer') return designerTabs[tab.id]?.isDirty ?? false
    if (tab.type !== 'object-editor') return false
    const editorTab = objectEditorTabs[tab.id]
    return editorTab ? editorTab.content !== editorTab.originalContent : false
  }
}

export function useRailItemRefs() {
  const itemRefs = useRef(new Map<RailKey, HTMLButtonElement>())
  const setItemRef = (key: RailKey) => (node: HTMLButtonElement | null) => {
    if (!node) {
      itemRefs.current.delete(key)
      return
    }
    itemRefs.current.set(key, node)
  }
  return { itemRefs, setItemRef }
}

export interface RailNavigationInputs {
  navigableKeys: RailKey[]
  pinnedByKey: Map<RailKey, WorkspaceTab>
  tabStopKey: RailKey | null
  tooltip: RailTooltipControls
  setItemRef: RailItemHandlers['setItemRef']
  focusItem: (key: RailKey) => void
  onSelect: (stackKey: WorkspaceTabStackKey) => void
  onFocusMembers?: (stackKey: WorkspaceTabStackKey) => void
  onSelectPinned?: (tabId: string) => void
}

export function buildRailItemHandlers(inputs: RailNavigationInputs): RailItemHandlers {
  const { navigableKeys, pinnedByKey, tooltip } = inputs
  const selectKey = (key: RailKey) => {
    const pinnedTab = pinnedByKey.get(key)
    if (pinnedTab) {
      inputs.onSelectPinned?.(pinnedTab.id)
      return
    }
    inputs.onSelect(key as WorkspaceTabStackKey)
  }
  const focusMembersFromKey = (event: KeyboardEvent<HTMLButtonElement>, key: RailKey) => {
    if (pinnedByKey.has(key)) return
    event.preventDefault()
    tooltip.hideTooltip()
    inputs.onFocusMembers?.(key as WorkspaceTabStackKey)
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, key: RailKey) => {
    if (event.key === 'ArrowRight') {
      focusMembersFromKey(event, key)
      return
    }
    const resolveTarget = RAIL_NAVIGATION_TARGETS[event.key]
    if (!resolveTarget) return
    event.preventDefault()
    tooltip.hideTooltip()
    const target = resolveTarget(navigableKeys, navigableKeys.indexOf(key))
    if (!target) return
    if (target !== key) selectKey(target)
    inputs.focusItem(target)
  }
  return {
    isTabStop: (key) => key === inputs.tabStopKey,
    setItemRef: inputs.setItemRef,
    onClick: (key) => {
      tooltip.hideTooltip()
      selectKey(key)
    },
    onMouseEnter: tooltip.scheduleTooltip,
    onMouseLeave: tooltip.hideTooltip,
    onKeyDown: handleKeyDown,
  }
}
