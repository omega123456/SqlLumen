/**
 * Shared dismiss coordination for context menus.
 *
 * When one context menu opens, it dispatches a custom event so any other
 * open context menu closes itself — ensuring only one is visible at a time.
 */

export const DISMISS_ALL_CONTEXT_MENUS = 'dismissAllContextMenus'

/** Dispatch a custom event that tells all context menus to close. */
export function dispatchDismissAll(): void {
  document.dispatchEvent(new Event(DISMISS_ALL_CONTEXT_MENUS))
}
