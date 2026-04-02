import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

const { logFrontendMock } = vi.hoisted(() => ({
  logFrontendMock: vi.fn(),
}))

vi.mock('../lib/app-log-commands', () => ({
  logFrontend: logFrontendMock,
}))

import {
  useToastStore,
  _resetToastTimeoutsForTests,
  SUCCESS_TOAST_DURATION_MS,
  WARNING_ERROR_TOAST_DURATION_MS,
} from '../stores/toast-store'

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

  it('showSuccess appends a toast with default short duration', () => {
    useToastStore.getState().showSuccess('Saved', 'Details')
    const { toasts } = useToastStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].variant).toBe('success')
    expect(toasts[0].title).toBe('Saved')
    expect(toasts[0].message).toBe('Details')
    expect(toasts[0].durationMs).toBe(SUCCESS_TOAST_DURATION_MS)
  })

  it('showError appends with default long duration', () => {
    useToastStore.getState().showError('Oops')
    const { toasts } = useToastStore.getState()
    expect(toasts[0].durationMs).toBe(WARNING_ERROR_TOAST_DURATION_MS)
  })

  it('showWarning appends with default long duration', () => {
    useToastStore.getState().showWarning('Heads up', 'Details')
    const { toasts } = useToastStore.getState()
    expect(toasts[0].variant).toBe('warning')
    expect(toasts[0].durationMs).toBe(WARNING_ERROR_TOAST_DURATION_MS)
  })

  it('showError logs to application logger at error level', () => {
    useToastStore.getState().showError('Title', 'Body')
    expect(logFrontendMock).toHaveBeenCalledWith('error', 'Title: Body')
  })

  it('showWarning logs to application logger at warn level', () => {
    useToastStore.getState().showWarning('Title', 'Body')
    expect(logFrontendMock).toHaveBeenCalledWith('warn', 'Title: Body')
  })

  it('showError log line uses title only when message is omitted', () => {
    useToastStore.getState().showError('Only')
    expect(logFrontendMock).toHaveBeenCalledWith('error', 'Only')
  })

  it('showWarning log line uses title only when message is omitted', () => {
    useToastStore.getState().showWarning('Only')
    expect(logFrontendMock).toHaveBeenCalledWith('warn', 'Only')
  })

  it('error and warning accept duration override', () => {
    useToastStore.getState().showError('e', undefined, 3000)
    useToastStore.getState().showWarning('w', undefined, 4000)
    const { toasts } = useToastStore.getState()
    expect(toasts.find((t) => t.title === 'e')?.durationMs).toBe(3000)
    expect(toasts.find((t) => t.title === 'w')?.durationMs).toBe(4000)
  })

  it('dismiss removes a toast', () => {
    const id = useToastStore.getState().showError('Oops')
    expect(useToastStore.getState().toasts).toHaveLength(1)
    useToastStore.getState().dismiss(id)
    expect(useToastStore.getState().toasts).toEqual([])
  })

  it('caps visible toasts at 5 (drops oldest)', () => {
    for (let i = 0; i < 6; i++) {
      useToastStore.getState().showWarning(`msg-${i}`)
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
