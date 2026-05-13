/** Dispatched when the workspace ↔ AI split is resized so Monaco can relayout. */
export const WORKSPACE_LAYOUT_EVENT = 'sqllumen-workspace-main-resize'

export function dispatchWorkspaceLayoutResize(): void {
  window.dispatchEvent(new CustomEvent(WORKSPACE_LAYOUT_EVENT))
}
