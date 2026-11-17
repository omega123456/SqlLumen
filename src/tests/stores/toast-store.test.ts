import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

import { ipc } from '../ipc-mock'
import {
  useToastStore,
  _resetToastTimeoutsForTests,
  SUCCESS_TOAST_DURATION_MS,
  UNTIL_DISMISSED,
  WARNING_ERROR_TOAST_DURATION_MS,
} from '../../stores/toast-store'

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

  it('showError logs at error level with the title and optional message', async () => {
    useToastStore.getState().showError('Title', 'Body')
    useToastStore.getState().showError('Only')
    await Promise.resolve()
    expect(ipc.payloads('log_frontend')).toEqual(
      expect.arrayContaining([
        { level: 'error', message: 'Title: Body' },
        { level: 'error', message: 'Only' },
      ])
    )
  })

  it('showWarning logs at warn level with the title and optional message', async () => {
    useToastStore.getState().showWarning('Title', 'Body')
    useToastStore.getState().showWarning('Only')
    await Promise.resolve()
    expect(ipc.payloads('log_frontend')).toEqual(
      expect.arrayContaining([
        { level: 'warn', message: 'Title: Body' },
        { level: 'warn', message: 'Only' },
      ])
    )
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

  it('auto-dismisses after duration and keeps an until-dismissed toast', () => {
    vi.useFakeTimers()
    useToastStore.getState().showSuccess('x', undefined, 3000)
    useToastStore.getState().showWarning('stays', undefined, UNTIL_DISMISSED)
    expect(useToastStore.getState().toasts).toHaveLength(2)
    vi.advanceTimersByTime(2999)
    expect(useToastStore.getState().toasts).toHaveLength(2)
    vi.advanceTimersByTime(60_000)
    expect(useToastStore.getState().toasts.map((toast) => toast.title)).toEqual(['stays'])
  })

  it('dismiss clears pending auto-dismiss', () => {
    vi.useFakeTimers()
    const id = useToastStore.getState().showSuccess('x', undefined, 5000)
    useToastStore.getState().dismiss(id)
    vi.advanceTimersByTime(10_000)
    expect(useToastStore.getState().toasts).toEqual([])
  })
})
