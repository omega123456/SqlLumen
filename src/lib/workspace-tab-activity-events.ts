export const WORKSPACE_TAB_DEACTIVATED_EVENT = 'workspace-tab-deactivated'
export const WORKSPACE_TAB_ACTIVATED_EVENT = 'workspace-tab-activated'

export interface WorkspaceTabActivityEventDetail {
  tabId: string
  connectionId: string
}

function dispatchWorkspaceTabActivityEvent(
  eventName: string,
  tabId: string,
  connectionId: string
): void {
  document.dispatchEvent(
    new CustomEvent<WorkspaceTabActivityEventDetail>(eventName, {
      detail: { tabId, connectionId },
    })
  )
}

function subscribeToTabActivityEvent(
  eventName: string,
  tabId: string,
  callback: () => void
): () => void {
  const handleEvent = (event: Event) => {
    const detail = (event as CustomEvent<WorkspaceTabActivityEventDetail>).detail
    if (detail?.tabId === tabId) {
      callback()
    }
  }

  document.addEventListener(eventName, handleEvent)
  return () => {
    document.removeEventListener(eventName, handleEvent)
  }
}

export function dispatchWorkspaceTabDeactivated(tabId: string, connectionId: string): void {
  dispatchWorkspaceTabActivityEvent(WORKSPACE_TAB_DEACTIVATED_EVENT, tabId, connectionId)
}

export function dispatchWorkspaceTabActivated(tabId: string, connectionId: string): void {
  dispatchWorkspaceTabActivityEvent(WORKSPACE_TAB_ACTIVATED_EVENT, tabId, connectionId)
}

export function subscribeToTabDeactivated(tabId: string, callback: () => void): () => void {
  return subscribeToTabActivityEvent(WORKSPACE_TAB_DEACTIVATED_EVENT, tabId, callback)
}

export function subscribeToTabActivated(tabId: string, callback: () => void): () => void {
  return subscribeToTabActivityEvent(WORKSPACE_TAB_ACTIVATED_EVENT, tabId, callback)
}
