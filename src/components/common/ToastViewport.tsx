import { createPortal } from 'react-dom'
import type { CSSProperties } from 'react'
import { X, CheckCircle, Warning, XCircle, type Icon } from '@phosphor-icons/react'
import { useToastStore, type ToastItem } from '../../stores/toast-store'
import styles from './ToastViewport.module.css'

const TOAST_ICON_SIZE = 24

interface ToastVariantPresentation {
  toastClassName: string
  iconWellClassName: string
  progressClassName: string
  VariantIcon: Icon
}

const TOAST_VARIANT_PRESENTATION: Record<ToastItem['variant'], ToastVariantPresentation> = {
  error: {
    toastClassName: styles.toastError,
    iconWellClassName: `${styles.iconWell} ${styles.iconWellError}`,
    progressClassName: `${styles.progressFill} ${styles.progressError}`,
    VariantIcon: XCircle,
  },
  success: {
    toastClassName: styles.toastSuccess,
    iconWellClassName: `${styles.iconWell} ${styles.iconWellSuccess}`,
    progressClassName: `${styles.progressFill} ${styles.progressSuccess}`,
    VariantIcon: CheckCircle,
  },
  warning: {
    toastClassName: styles.toastWarning,
    iconWellClassName: `${styles.iconWell} ${styles.iconWellWarning}`,
    progressClassName: `${styles.progressFill} ${styles.progressWarning}`,
    VariantIcon: Warning,
  },
}

function variantClass(variant: ToastItem['variant']) {
  return TOAST_VARIANT_PRESENTATION[variant].toastClassName
}

function iconWellClass(variant: ToastItem['variant']) {
  return TOAST_VARIANT_PRESENTATION[variant].iconWellClassName
}

function progressClass(variant: ToastItem['variant']) {
  return TOAST_VARIANT_PRESENTATION[variant].progressClassName
}

function ToastIcon({ variant }: { variant: ToastItem['variant'] }) {
  const { VariantIcon } = TOAST_VARIANT_PRESENTATION[variant]
  return <VariantIcon size={TOAST_ICON_SIZE} weight="fill" aria-hidden />
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
  const toasts = useToastStore((state) => state.toasts)
  const dismiss = useToastStore((state) => state.dismiss)

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
