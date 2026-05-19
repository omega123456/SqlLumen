import { describe, expect, it, vi } from 'vitest'

import {
  WORKSPACE_LAYOUT_EVENT,
  dispatchWorkspaceLayoutResize,
} from '../../lib/workspace-layout-events'

describe('workspace-layout-events', () => {
  it('dispatches the workspace resize event on window', () => {
    const handler = vi.fn()
    window.addEventListener(WORKSPACE_LAYOUT_EVENT, handler)

    dispatchWorkspaceLayoutResize()

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0]?.[0]).toBeInstanceOf(CustomEvent)

    window.removeEventListener(WORKSPACE_LAYOUT_EVENT, handler)
  })
})
