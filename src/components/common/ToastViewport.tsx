import type { CSSProperties } from 'react'
import { X, CheckCircle, Info, XCircle } from '@phosphor-icons/react'
import { useToastStore, type ToastItem } from '../../stores/toast-store'
import styles from './ToastViewport.module.css'

function variantClass(v: ToastItem['variant']) {
  if (v === 'error') {
    return styles.toastError
  }
  if (v === 'success') {
    return styles.toastSuccess
  }
  return ''
}

function iconWellClass(v: ToastItem['variant']) {
  if (v === 'error') {
    return `${styles.iconWell} ${styles.iconWellError}`
  }
  if (v === 'success') {
    return `${styles.iconWell} ${styles.iconWellSuccess}`
  }
  return `${styles.iconWell} ${styles.iconWellInfo}`
}

function progressClass(v: ToastItem['variant']) {
  if (v === 'error') {
    return `${styles.progressFill} ${styles.progressError}`
  }
  if (v === 'success') {
    return `${styles.progressFill} ${styles.progressSuccess}`
  }
  return `${styles.progressFill} ${styles.progressInfo}`
}

function ToastIcon({ variant }: { variant: ToastItem['variant'] }) {
  const common = { size: 24 as const, weight: 'fill' as const }
  if (variant === 'success') {
    return <CheckCircle {...common} aria-hidden />
  }
  if (variant === 'error') {
    return <XCircle {...common} aria-hidden />
  }
  return <Info {...common} aria-hidden />
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: string) => void }) {
  const role = item.variant === 'error' ? 'alert' : 'status'
  const progressStyle: CSSProperties = { animationDuration: `${item.durationMs}ms` }

  return (
    <div
      className={`${styles.toast} ${variantClass(item.variant)}`}
      role={role}
      data-testid="toast-item"
      data-toast-variant={item.variant}
    >
      <div className={styles.surface}>
        <div className={iconWellClass(item.variant)}>
          <ToastIcon variant={item.variant} />
        </div>
        <div className={styles.body}>
          <div className={styles.headerRow}>
            <h3 className={styles.title}>{item.title}</h3>
            <button
              type="button"
              className={styles.close}
              aria-label="Dismiss notification"
              data-testid="toast-dismiss"
              onClick={() => {
                onDismiss(item.id)
              }}
            >
              <X size={18} weight="regular" aria-hidden />
            </button>
          </div>
          {item.message ? <p className={styles.message}>{item.message}</p> : null}
        </div>
      </div>
      <div className={styles.progressTrack} aria-hidden>
        <div className={progressClass(item.variant)} style={progressStyle} />
      </div>
    </div>
  )
}

export function ToastViewport() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)

  if (toasts.length === 0) {
    return null
  }

  return (
    <div className={styles.viewport} data-testid="toast-stack" aria-live="polite" aria-relevant="additions">
      <div className={styles.stack}>
        {toasts.map((item) => (
          <ToastCard key={item.id} item={item} onDismiss={dismiss} />
        ))}
      </div>
    </div>
  )
}
