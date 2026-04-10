import { createPortal } from 'react-dom'
import type { CSSProperties } from 'react'
import { X, CheckCircle, Warning, XCircle } from '@phosphor-icons/react'
import { useToastStore, type ToastItem } from '../../stores/toast-store'
import styles from './ToastViewport.module.css'

function variantClass(v: ToastItem['variant']) {
  switch (v) {
    case 'error':
      return styles.toastError
    case 'success':
      return styles.toastSuccess
    case 'warning':
      return styles.toastWarning
  }
}

function iconWellClass(v: ToastItem['variant']) {
  switch (v) {
    case 'error':
      return `${styles.iconWell} ${styles.iconWellError}`
    case 'success':
      return `${styles.iconWell} ${styles.iconWellSuccess}`
    case 'warning':
      return `${styles.iconWell} ${styles.iconWellWarning}`
  }
}

function progressClass(v: ToastItem['variant']) {
  switch (v) {
    case 'error':
      return `${styles.progressFill} ${styles.progressError}`
    case 'success':
      return `${styles.progressFill} ${styles.progressSuccess}`
    case 'warning':
      return `${styles.progressFill} ${styles.progressWarning}`
  }
}

function ToastIcon({ variant }: { variant: ToastItem['variant'] }) {
  const common = { size: 24 as const, weight: 'fill' as const }
  switch (variant) {
    case 'success':
      return <CheckCircle {...common} aria-hidden />
    case 'error':
      return <XCircle {...common} aria-hidden />
    case 'warning':
      return <Warning {...common} aria-hidden />
  }
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

  const openDialogs = Array.from(document.querySelectorAll('dialog[open]'))
  const portalTarget = openDialogs.length > 0 ? openDialogs[openDialogs.length - 1] : document.body

  const content = (
    <div
      className={styles.viewport}
      data-testid="toast-stack"
      aria-live="polite"
      aria-relevant="additions"
    >
      <div className={styles.stack}>
        {toasts.map((item) => (
          <ToastCard key={item.id} item={item} onDismiss={dismiss} />
        ))}
      </div>
    </div>
  )

  return createPortal(content, portalTarget)
}
