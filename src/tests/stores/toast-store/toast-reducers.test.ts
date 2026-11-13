import { describe, expect, it } from 'vitest'
import {
  overflowingToasts,
  pushVisibleToast,
  removeToast,
} from '../../../stores/toast-store/toast-reducers'
import type { ToastItem } from '../../../stores/toast-store'

const MAX_VISIBLE = 2
const TOAST_DURATION_MS = 5000

function toast(id: string): ToastItem {
  return { id: id, variant: 'success', title: id, durationMs: TOAST_DURATION_MS }
}

describe('toast reducers', () => {
  it('lists the oldest toasts that no longer fit', () => {
    const toasts = [toast('a'), toast('b'), toast('c')]
    expect(overflowingToasts(toasts, MAX_VISIBLE).map((item) => item.id)).toEqual(['a'])
    expect(overflowingToasts([toast('a')], MAX_VISIBLE)).toEqual([])
  })

  it('pushes a toast and drops the oldest beyond the visible limit', () => {
    const state = { toasts: [toast('a'), toast('b')] }
    const pushed = pushVisibleToast(state, { toast: toast('c'), maxVisible: MAX_VISIBLE })
    expect(pushed.toasts.map((item) => item.id)).toEqual(['b', 'c'])
  })

  it('removes a toast by id', () => {
    expect(removeToast({ toasts: [toast('a'), toast('b')] }, 'a').toasts).toEqual([toast('b')])
  })
})
