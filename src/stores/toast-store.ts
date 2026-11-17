import { create } from 'zustand'

import { logFrontend } from '../lib/app-log-commands'
import { overflowingToasts, pushVisibleToast, removeToast } from './toast-store/toast-reducers'
export type ToastVariant = 'success' | 'error' | 'warning'

export interface ToastItem {
  id: string
  variant: ToastVariant
  title: string
  message?: string
  durationMs: ToastDuration
}

export type ToastDuration = number | null

export const SUCCESS_TOAST_DURATION_MS = 5000
export const WARNING_ERROR_TOAST_DURATION_MS = 20_000
export const UNTIL_DISMISSED = null

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
  const displacedToasts = overflowingToasts([...get().toasts, item], MAX_VISIBLE)
  displacedToasts.forEach((toast) => clearScheduled(toast.id))
  set((state) => pushVisibleToast(state, { toast: item, maxVisible: MAX_VISIBLE }))
  const id = item.id
  const durationMs = item.durationMs
  if (durationMs === UNTIL_DISMISSED) return id
  const timeout = setTimeout(() => {
    timeouts.delete(id)
    get().dismiss(id)
  }, durationMs)
  timeouts.set(id, timeout)
  return id
}

interface ToastState {
  toasts: ToastItem[]
  showSuccess: (title: string, message?: string, durationMs?: ToastDuration) => string
  showError: (title: string, message?: string, durationMs?: ToastDuration) => string
  showWarning: (title: string, message?: string, durationMs?: ToastDuration) => string
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
    set((state) => removeToast(state, id))
  },
}))

export function showSuccessToast(title: string, message?: string, durationMs?: ToastDuration) {
  return useToastStore.getState().showSuccess(title, message, durationMs)
}

export function showErrorToast(title: string, message?: string, durationMs?: ToastDuration) {
  return useToastStore.getState().showError(title, message, durationMs)
}

export function showWarningToast(title: string, message?: string, durationMs?: ToastDuration) {
  return useToastStore.getState().showWarning(title, message, durationMs)
}

export function _resetToastTimeoutsForTests() {
  for (const id of [...timeouts.keys()]) {
    clearScheduled(id)
  }
}
