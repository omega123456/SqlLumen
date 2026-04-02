import { create } from 'zustand'

import { logFrontend } from '../lib/app-log-commands'

export type ToastVariant = 'success' | 'error' | 'info'

export interface ToastItem {
  id: string
  variant: ToastVariant
  title: string
  message?: string
  durationMs: number
}

const DEFAULT_DURATION_MS = 5000
const MAX_VISIBLE = 5

const timeouts = new Map<string, ReturnType<typeof setTimeout>>()

function clearScheduled(id: string) {
  const t = timeouts.get(id)
  if (t) {
    clearTimeout(t)
    timeouts.delete(id)
  }
}

interface ToastState {
  toasts: ToastItem[]
  showSuccess: (title: string, message?: string, durationMs?: number) => string
  showError: (title: string, message?: string, durationMs?: number) => string
  showInfo: (title: string, message?: string, durationMs?: number) => string
  dismiss: (id: string) => void
}

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],

  showSuccess: (title, message, durationMs = DEFAULT_DURATION_MS) => {
    const id = crypto.randomUUID()
    const item: ToastItem = { id, variant: 'success', title, message, durationMs }
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
    const t = setTimeout(() => {
      timeouts.delete(id)
      get().dismiss(id)
    }, durationMs)
    timeouts.set(id, t)
    return id
  },

  showError: (title, message, durationMs = DEFAULT_DURATION_MS) => {
    const logLine = message ? `${title}: ${message}` : title
    logFrontend('error', logLine)
    const id = crypto.randomUUID()
    const item: ToastItem = { id, variant: 'error', title, message, durationMs }
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
    const t = setTimeout(() => {
      timeouts.delete(id)
      get().dismiss(id)
    }, durationMs)
    timeouts.set(id, t)
    return id
  },

  showInfo: (title, message, durationMs = DEFAULT_DURATION_MS) => {
    const id = crypto.randomUUID()
    const item: ToastItem = { id, variant: 'info', title, message, durationMs }
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
    const t = setTimeout(() => {
      timeouts.delete(id)
      get().dismiss(id)
    }, durationMs)
    timeouts.set(id, t)
    return id
  },

  dismiss: (id) => {
    clearScheduled(id)
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
  },
}))

/** For use outside React (e.g. Zustand connection store). */
export function showSuccessToast(title: string, message?: string, durationMs?: number) {
  return useToastStore.getState().showSuccess(title, message, durationMs)
}

export function showErrorToast(title: string, message?: string, durationMs?: number) {
  return useToastStore.getState().showError(title, message, durationMs)
}

export function showInfoToast(title: string, message?: string, durationMs?: number) {
  return useToastStore.getState().showInfo(title, message, durationMs)
}

/** Clear all timers — for tests. */
export function _resetToastTimeoutsForTests() {
  for (const id of [...timeouts.keys()]) {
    clearScheduled(id)
  }
}
