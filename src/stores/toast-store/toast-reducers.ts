import type { ToastItem } from '../toast-store'

interface ToastList {
  toasts: ToastItem[]
}

export interface ToastPush {
  toast: ToastItem
  maxVisible: number
}

export function overflowingToasts(toasts: ToastItem[], maxVisible: number): ToastItem[] {
  const overflowCount = Math.max(0, toasts.length - maxVisible)
  return toasts.slice(0, overflowCount)
}

export function pushVisibleToast(state: ToastList, { toast, maxVisible }: ToastPush): ToastList {
  const toasts = [...state.toasts, toast]
  return { toasts: toasts.slice(overflowingToasts(toasts, maxVisible).length) }
}

export function removeToast(state: ToastList, toastId: string): ToastList {
  return { toasts: state.toasts.filter((toast) => toast.id !== toastId) }
}
