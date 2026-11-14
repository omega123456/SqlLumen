import {
  ArrowLineLeftIcon,
  ArrowLineRightIcon,
  PencilSimpleIcon,
  CaretLineLeftIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CaretLineRightIcon,
  CrosshairIcon,
} from '@phosphor-icons/react'
import type { WorkspaceTab } from '../../../types/schema'
import type { TabContextMenuItem } from '../../shared/TabContextMenu'
import {
  getTabRevealTarget,
  isObjectTab,
  revealTabInObjectBrowser,
} from '../../../lib/object-activation'

export interface TabMenuTarget {
  tab: WorkspaceTab | null
  visibleIndex: number
  visibleTabIds: string[]
  revealShortcut: string | undefined
}

export interface TabMenuActions {
  rename: () => void
  moveToVisibleSlot: (visibleInsertIndex: number) => void
  moveOneSlot: (direction: 'left' | 'right') => void
  closeTabs: (tabIds: string[]) => void
}

function revealMenuItems(target: TabMenuTarget): TabContextMenuItem[] {
  const { tab } = target
  if (!tab) return []
  if (!isObjectTab(tab)) return []
  return [
    {
      key: 'reveal-in-object-browser',
      label: 'Reveal in object browser',
      icon: <CrosshairIcon size={14} weight="regular" />,
      shortcut: target.revealShortcut,
      disabled: getTabRevealTarget(tab) === null,
      separatorAfter: true,
      onSelect: () => {
        void revealTabInObjectBrowser(tab)
      },
    },
  ]
}

function isLastOrOutsideVisibleGroup(target: TabMenuTarget): boolean {
  return target.visibleIndex < 0 || target.visibleIndex >= target.visibleTabIds.length - 1
}

export function buildTabMenuItems(
  target: TabMenuTarget,
  actions: TabMenuActions
): TabContextMenuItem[] {
  const { visibleIndex, visibleTabIds } = target
  const isFirstVisible = visibleIndex <= 0
  const isLastVisible = isLastOrOutsideVisibleGroup(target)
  return [
    ...revealMenuItems(target),
    {
      key: 'rename',
      label: 'Rename',
      icon: <PencilSimpleIcon size={14} weight="regular" />,
      disabled: target.tab?.type !== 'query-editor',
      onSelect: actions.rename,
    },
    {
      key: 'move-start',
      label: 'Move to start',
      icon: <CaretLineLeftIcon size={14} weight="regular" />,
      disabled: isFirstVisible,
      onSelect: () => actions.moveToVisibleSlot(0),
    },
    {
      key: 'move-left',
      label: 'Move left',
      icon: <CaretLeftIcon size={14} weight="regular" />,
      disabled: isFirstVisible,
      onSelect: () => actions.moveOneSlot('left'),
    },
    {
      key: 'move-right',
      label: 'Move right',
      icon: <CaretRightIcon size={14} weight="regular" />,
      disabled: isLastVisible,
      onSelect: () => actions.moveOneSlot('right'),
    },
    {
      key: 'move-end',
      label: 'Move to end',
      icon: <CaretLineRightIcon size={14} weight="regular" />,
      disabled: isLastVisible,
      onSelect: () => actions.moveToVisibleSlot(visibleTabIds.length),
    },
    {
      key: 'close-left',
      label: 'Close tabs to the left',
      icon: <ArrowLineLeftIcon size={14} weight="regular" />,
      disabled: isFirstVisible,
      onSelect: () => actions.closeTabs(visibleTabIds.slice(0, visibleIndex)),
    },
    {
      key: 'close-right',
      label: 'Close tabs to the right',
      icon: <ArrowLineRightIcon size={14} weight="regular" />,
      disabled: isLastVisible,
      onSelect: () => actions.closeTabs(visibleTabIds.slice(visibleIndex + 1)),
    },
  ]
}
