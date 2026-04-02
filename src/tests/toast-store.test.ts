import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

const { logFrontendMock } = vi.hoisted(() => ({
  logFrontendMock: vi.fn(),
}))

vi.mock('../lib/app-log-commands', () => ({
  logFrontend: logFrontendMock,
}))

import { useToastStore, _resetToastTimeoutsForTests } from '../stores/toast-store'

describe('useToastStore', () => {
  beforeEach(() => {
    logFrontendMock.mockClear()
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

  it('showError logs to application logger at error level', () => {
    useToastStore.getState().showError('Title', 'Body')
    expect(logFrontendMock).toHaveBeenCalledWith('error', 'Title: Body')
  })

  it('showError log line uses title only when message is omitted', () => {
    useToastStore.getState().showError('Only')
    expect(logFrontendMock).toHaveBeenCalledWith('error', 'Only')
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
