import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useConnectionsPageStore } from '../../stores/connections-page-store'

beforeEach(() => {
  useConnectionsPageStore.getState().closePage()
})

describe('connections page store', () => {
  it('opens on the board and shows a profile', () => {
    const page = useConnectionsPageStore.getState()
    page.openPage()
    page.showProfile({ kind: 'existing', profileId: 'conn-1' })
    expect(useConnectionsPageStore.getState()).toMatchObject({
      isOpen: true,
      view: { kind: 'profile', target: { kind: 'existing', profileId: 'conn-1' } },
    })
    page.showBoard()
    expect(useConnectionsPageStore.getState().view).toEqual({ kind: 'board' })
  })

  it('leaves at once without edits, and asks first with them', () => {
    const page = useConnectionsPageStore.getState()
    const leave = vi.fn()
    page.requestLeave(leave)
    expect(leave).toHaveBeenCalledTimes(1)

    page.setUnsavedEdits(true)
    page.requestLeave(leave)
    expect(leave).toHaveBeenCalledTimes(1)
    page.cancelLeave()
    expect(useConnectionsPageStore.getState().pendingLeave).toBeNull()

    page.requestLeave(leave)
    page.confirmLeave()
    expect(leave).toHaveBeenCalledTimes(2)
    expect(useConnectionsPageStore.getState().hasUnsavedEdits).toBe(false)
  })
})
