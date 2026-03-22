import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useToastStore, _resetToastTimeoutsForTests } from '../stores/toast-store'

describe('useToastStore', () => {
  beforeEach(() => {
    _resetToastTimeoutsForTests()
    useToastStore.setState({ toasts: [] })
  })

  afterEach(() => {
    vi.useRealTimers()
    _resetToastTimeoutsForTests()
  })

  it('starts empty', () => {
    expect(useToastStore.getState().toasts).toEqual([])
  })

  it('showSuccess appends a toast', () => {
    useToastStore.getState().showSuccess('Saved', 'Details')
    const { toasts } = useToastStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].variant).toBe('success')
    expect(toasts[0].title).toBe('Saved')
    expect(toasts[0].message).toBe('Details')
  })

  it('dismiss removes a toast', () => {
    const id = useToastStore.getState().showError('Oops')
    expect(useToastStore.getState().toasts).toHaveLength(1)
    useToastStore.getState().dismiss(id)
    expect(useToastStore.getState().toasts).toEqual([])
  })

  it('caps visible toasts at 5 (drops oldest)', () => {
    for (let i = 0; i < 6; i++) {
      useToastStore.getState().showInfo(`msg-${i}`)
    }
    const { toasts } = useToastStore.getState()
    expect(toasts).toHaveLength(5)
    expect(toasts.map((t) => t.title)).toEqual(['msg-1', 'msg-2', 'msg-3', 'msg-4', 'msg-5'])
  })

  it('auto-dismisses after duration', () => {
    vi.useFakeTimers()
    useToastStore.getState().showSuccess('x', undefined, 3000)
    expect(useToastStore.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(2999)
    expect(useToastStore.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(2)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('dismiss clears pending auto-dismiss', () => {
    vi.useFakeTimers()
    const id = useToastStore.getState().showSuccess('x', undefined, 5000)
    useToastStore.getState().dismiss(id)
    vi.advanceTimersByTime(10_000)
    expect(useToastStore.getState().toasts).toEqual([])
  })
})
