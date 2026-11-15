import { joinClassNames } from './class-names'

export const CONTEXT_MENU =
  'fixed z-1000 flex flex-col min-w-context-menu p-1 rounded-overlay border border-light-stroke-flyout dark:border-dark-stroke-flyout bg-light-surface-container-high dark:bg-dark-surface-container-high shadow-light-flyout dark:shadow-dark-flyout'

export const CONTEXT_MENU_ICON = 'inline-flex shrink-0 text-inherit'

export const CONTEXT_MENU_SEPARATOR =
  'block flex-none h-px -mx-1 my-1 p-0 border-0 bg-light-stroke-divider dark:bg-dark-stroke-divider'

type ContextMenuItemTone = 'default' | 'destructive'

const ITEM_FRAME =
  'group flex flex-none items-center gap-3 w-full h-menu-item px-2.5 rounded-control bg-transparent font-body text-body font-regular whitespace-nowrap text-left cursor-default disabled:cursor-not-allowed focus-visible:outline-none focus-visible:shadow-none not-disabled:hover:bg-light-fill-subtle-hover dark:not-disabled:hover:bg-dark-fill-subtle-hover not-disabled:focus-visible:bg-light-fill-subtle-hover dark:not-disabled:focus-visible:bg-dark-fill-subtle-hover disabled:text-light-text-disabled dark:disabled:text-dark-text-disabled'

const ITEM_TONE_CLASSES: Record<ContextMenuItemTone, string> = {
  default: joinClassNames([ITEM_FRAME, 'text-light-on-surface dark:text-dark-on-surface']),
  destructive: joinClassNames([ITEM_FRAME, 'text-light-error dark:text-dark-error']),
}

export function contextMenuItemClassName(isDestructive: boolean | undefined): string {
  if (isDestructive) return ITEM_TONE_CLASSES.destructive
  return ITEM_TONE_CLASSES.default
}

export type ListboxOptionState = 'idle' | 'highlighted'

export const LISTBOX_OPTION_STATE_CLASSES: Record<ListboxOptionState, string> = {
  idle: 'hover:bg-light-fill-subtle-hover dark:hover:bg-dark-fill-subtle-hover',
  highlighted: 'bg-light-fill-subtle-hover dark:bg-dark-fill-subtle-hover',
}

export function listboxOptionState(isHighlighted: boolean): ListboxOptionState {
  if (isHighlighted) return 'highlighted'
  return 'idle'
}
