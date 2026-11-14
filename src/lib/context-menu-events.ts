export const DISMISS_ALL_CONTEXT_MENUS = 'dismissAllContextMenus'

export function dispatchDismissAll(): void {
  document.dispatchEvent(new Event(DISMISS_ALL_CONTEXT_MENUS))
}
