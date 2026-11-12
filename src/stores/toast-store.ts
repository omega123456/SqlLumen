import { create } from 'zustand'

import { logFrontend } from '../lib/app-log-commands'
export type ToastVariant = 'success' | 'error' | 'warning'

export interface ToastItem {
  id: string
  variant: ToastVariant
  title: string
  message?: string
  durationMs: number
}

export const SUCCESS_TOAST_DURATION_MS = 5000
export const WARNING_ERROR_TOAST_DURATION_MS = 20_000

const MAX_VISIBLE = 5

const timeouts = new Map<string, ReturnType<typeof setTimeout>>()

function clearScheduled(id: string) {
  const timeout = timeouts.get(id)
  if (timeout) {
    clearTimeout(timeout)
    timeouts.delete(id)
  }
}

type ToastGetter = () => ToastState
type ToastSetter = (
  partial:
    ToastState | Partial<ToastState> | ((state: ToastState) => ToastState | Partial<ToastState>)
) => void

function pushToast(set: ToastSetter, get: ToastGetter, item: ToastItem): string {
  set((state) => {
    const next = [...state.toasts, item]
    while (next.length > MAX_VISIBLE) {
      const removed = next.shift()
      if (removed) {
        clearScheduled(removed.id)
      }
    }
    return { toasts: next }
  })
  const id = item.id
  const timeout = setTimeout(() => {
    timeouts.delete(id)
    get().dismiss(id)
  }, item.durationMs)
  timeouts.set(id, timeout)
  return id
}

interface ToastState {
  toasts: ToastItem[]
  showSuccess: (title: string, message?: string, durationMs?: number) => string
  showError: (title: string, message?: string, durationMs?: number) => string
  showWarning: (title: string, message?: string, durationMs?: number) => string
  dismiss: (id: string) => void
}

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],

  showSuccess: (title, message, durationMs = SUCCESS_TOAST_DURATION_MS) => {
    const id = crypto.randomUUID()
    const item: ToastItem = {
      id: id,
      variant: 'success',
      title: title,
      message: message,
      durationMs: durationMs,
    }
    return pushToast(set, get, item)
  },

  showError: (title, message, durationMs = WARNING_ERROR_TOAST_DURATION_MS) => {
    const logLine = message ? `${title}: ${message}` : title
    logFrontend('error', logLine)
    const id = crypto.randomUUID()
    const item: ToastItem = {
      id: id,
      variant: 'error',
      title: title,
      message: message,
      durationMs: durationMs,
    }
    return pushToast(set, get, item)
  },

  showWarning: (title, message, durationMs = WARNING_ERROR_TOAST_DURATION_MS) => {
    const logLine = message ? `${title}: ${message}` : title
    logFrontend('warn', logLine)
    const id = crypto.randomUUID()
    const item: ToastItem = {
      id: id,
      variant: 'warning',
      title: title,
      message: message,
      durationMs: durationMs,
    }
    return pushToast(set, get, item)
  },

  dismiss: (id) => {
    clearScheduled(id)
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }))
  },
}))

/** For use outside React (e.g. Zustand connection store). */
export function showSuccessToast(title: string, message?: string, durationMs?: number) {
  return useToastStore.getState().showSuccess(title, message, durationMs)
}

export function showErrorToast(title: string, message?: string, durationMs?: number) {
  return useToastStore.getState().showError(title, message, durationMs)
}

export function showWarningToast(title: string, message?: string, durationMs?: number) {
  return useToastStore.getState().showWarning(title, message, durationMs)
}

/** Clear all timers — for tests. */
export function _resetToastTimeoutsForTests() {
  for (const id of [...timeouts.keys()]) {
    clearScheduled(id)
  }
}
