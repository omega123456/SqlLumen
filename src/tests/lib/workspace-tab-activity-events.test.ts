import { describe, expect, it, vi } from 'vitest'

import {
  WORKSPACE_TAB_ACTIVATED_EVENT,
  WORKSPACE_TAB_DEACTIVATED_EVENT,
  dispatchWorkspaceTabActivated,
  dispatchWorkspaceTabDeactivated,
  subscribeToTabActivated,
  subscribeToTabDeactivated,
} from '../../lib/workspace-tab-activity-events'

describe('workspace-tab-activity-events', () => {
  it('dispatches deactivated and activated events with tab detail', () => {
    const activatedListener = vi.fn()
    const deactivatedListener = vi.fn()

    document.addEventListener(WORKSPACE_TAB_ACTIVATED_EVENT, activatedListener)
    document.addEventListener(WORKSPACE_TAB_DEACTIVATED_EVENT, deactivatedListener)

    dispatchWorkspaceTabActivated('tab-1', 'conn-1')
    dispatchWorkspaceTabDeactivated('tab-1', 'conn-1')

    expect(activatedListener).toHaveBeenCalledTimes(1)
    expect(deactivatedListener).toHaveBeenCalledTimes(1)
    expect((activatedListener.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      tabId: 'tab-1',
      connectionId: 'conn-1',
    })
    expect((deactivatedListener.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      tabId: 'tab-1',
      connectionId: 'conn-1',
    })

    document.removeEventListener(WORKSPACE_TAB_ACTIVATED_EVENT, activatedListener)
    document.removeEventListener(WORKSPACE_TAB_DEACTIVATED_EVENT, deactivatedListener)
  })

  it('subscribes only to matching tab ids and unsubscribes cleanly', () => {
    const onActivated = vi.fn()
    const onDeactivated = vi.fn()

    const unsubscribeActivated = subscribeToTabActivated('tab-1', onActivated)
    const unsubscribeDeactivated = subscribeToTabDeactivated('tab-1', onDeactivated)

    dispatchWorkspaceTabActivated('tab-2', 'conn-1')
    dispatchWorkspaceTabDeactivated('tab-2', 'conn-1')
    expect(onActivated).not.toHaveBeenCalled()
    expect(onDeactivated).not.toHaveBeenCalled()

    dispatchWorkspaceTabActivated('tab-1', 'conn-2')
    dispatchWorkspaceTabDeactivated('tab-1', 'conn-2')
    expect(onActivated).toHaveBeenCalledTimes(1)
    expect(onDeactivated).toHaveBeenCalledTimes(1)

    unsubscribeActivated()
    unsubscribeDeactivated()

    dispatchWorkspaceTabActivated('tab-1', 'conn-3')
    dispatchWorkspaceTabDeactivated('tab-1', 'conn-3')
    expect(onActivated).toHaveBeenCalledTimes(1)
    expect(onDeactivated).toHaveBeenCalledTimes(1)
  })
})
