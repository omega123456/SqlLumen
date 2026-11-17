import { createPortal } from 'react-dom'
import type { CSSProperties } from 'react'
import { X, CheckCircle, Warning, XCircle, type Icon } from '@phosphor-icons/react'
import { joinClassNames } from '../../lib/class-names'
import { FOCUS_RING } from '../../lib/focus-ring'
import {
  UNTIL_DISMISSED,
  useToastStore,
  type ToastDuration,
  type ToastItem,
} from '../../stores/toast-store'

const TOAST_ICON_SIZE = 16

interface ToastVariantPresentation {
  iconWellClassName: string
  progressClassName: string
  VariantIcon: Icon
}

const TOAST_VARIANT_PRESENTATION: Record<ToastItem['variant'], ToastVariantPresentation> = {
  error: {
    iconWellClassName: 'text-light-error dark:text-dark-error',
    progressClassName: 'bg-light-error dark:bg-dark-error',
    VariantIcon: XCircle,
  },
  success: {
    iconWellClassName: 'text-light-tertiary dark:text-dark-tertiary',
    progressClassName: 'bg-light-tertiary dark:bg-dark-tertiary',
    VariantIcon: CheckCircle,
  },
  warning: {
    iconWellClassName: 'text-light-warning dark:text-dark-warning',
    progressClassName: 'bg-light-warning dark:bg-dark-warning',
    VariantIcon: Warning,
  },
}

function ToastIcon({ variant }: { variant: ToastItem['variant'] }) {
  const { VariantIcon } = TOAST_VARIANT_PRESENTATION[variant]
  return <VariantIcon size={TOAST_ICON_SIZE} weight="fill" aria-hidden />
}

function progressStyleFor(durationMs: ToastDuration): CSSProperties {
  if (durationMs === UNTIL_DISMISSED) return {}
  return { animationDuration: `${durationMs}ms` }
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: string) => void }) {
  const role = item.variant === 'error' ? 'alert' : 'status'
  const progressStyle = progressStyleFor(item.durationMs)

  return (
    <div
      className="flex max-w-toast flex-col rounded-overlay border border-light-stroke-flyout bg-light-surface-container-high shadow-light-flyout dark:border-dark-stroke-flyout dark:bg-dark-surface-container-high dark:shadow-dark-flyout"
      role={role}
      data-testid="toast-item"
      data-toast-variant={item.variant}
    >
      <div className="flex w-full flex-row items-start gap-3 py-3.5 pr-2 pl-4">
        <div
          className={joinClassNames([
            'mt-0.5 flex size-4 shrink-0 items-center justify-center',
            TOAST_VARIANT_PRESENTATION[item.variant].iconWellClassName,
          ])}
        >
          <ToastIcon variant={item.variant} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="wrap-break-word font-body text-body font-semibold text-light-on-surface dark:text-dark-on-surface">
              {item.title}
            </h3>
            <button
              type="button"
              className={joinClassNames([
                'shrink-0 cursor-pointer border-0 bg-transparent p-0 leading-flat text-light-on-surface dark:text-dark-on-surface',
                FOCUS_RING,
              ])}
              aria-label="Dismiss notification"
              data-testid="toast-dismiss"
              onClick={() => {
                onDismiss(item.id)
              }}
            >
              <X size={18} weight="regular" aria-hidden />
            </button>
          </div>
          {item.message ? (
            <p className="mt-0.5 wrap-break-word font-body text-row text-light-on-surface-variant dark:text-dark-on-surface-variant">
              {item.message}
            </p>
          ) : null}
        </div>
      </div>
      <div className="hidden" aria-hidden>
        <div
          className={joinClassNames([
            'block h-full w-full origin-left animate-toast-progress window-blurred:animate-toast-progress-paused',
            TOAST_VARIANT_PRESENTATION[item.variant].progressClassName,
          ])}
          style={progressStyle}
        />
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
      className="pointer-events-none fixed inset-0 z-10050 flex max-w-screen flex-col items-end justify-end gap-2 px-4 pt-4 pb-10"
      data-testid="toast-stack"
      aria-live="polite"
      aria-relevant="additions"
    >
      <div className="pointer-events-auto flex w-full max-w-toast flex-col gap-2">
        {toasts.map((item) => (
          <ToastCard key={item.id} item={item} onDismiss={dismiss} />
        ))}
      </div>
    </div>
  )

  return createPortal(content, portalTarget)
}
