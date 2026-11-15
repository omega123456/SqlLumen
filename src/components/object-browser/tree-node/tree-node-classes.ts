import { joinClassNames } from '../../../lib/class-names'

export interface TreeRowState {
  isSelected: boolean
  isPinned: boolean
}

type TreeRowSelection = 'idle' | 'selected'
type TreeRowCursor = 'default' | 'pinned'

const ROW_FRAME =
  'relative mx-1 flex h-tree-row items-center gap-1.5 rounded-control pr-2 select-none focus-visible:outline-none data-suppress-focus-ring:focus-visible:shadow-none not-data-suppress-focus-ring:focus-visible:shadow-light-focus-ring dark:not-data-suppress-focus-ring:focus-visible:shadow-dark-focus-ring'

const ROW_SELECTION_CLASSES: Record<TreeRowSelection, string> = {
  idle: 'hover:bg-light-fill-subtle-hover dark:hover:bg-dark-fill-subtle-hover',
  selected:
    'bg-light-fill-neutral-selected before:absolute before:top-1/2 before:left-0 before:-mt-2 before:h-4 before:w-0.75 before:rounded-track before:bg-light-primary dark:bg-dark-fill-neutral-selected dark:before:bg-dark-primary',
}

const ROW_CURSOR_CLASSES: Record<TreeRowCursor, string> = {
  default: 'cursor-default',
  pinned: 'cursor-pointer',
}

function selectionOf(isSelected: boolean): TreeRowSelection {
  if (isSelected) return 'selected'
  return 'idle'
}

function cursorOf(isPinned: boolean): TreeRowCursor {
  if (isPinned) return 'pinned'
  return 'default'
}

export function treeRowClassName({ isSelected, isPinned }: TreeRowState): string {
  return joinClassNames([
    ROW_FRAME,
    ROW_SELECTION_CLASSES[selectionOf(isSelected)],
    ROW_CURSOR_CLASSES[cursorOf(isPinned)],
  ])
}
