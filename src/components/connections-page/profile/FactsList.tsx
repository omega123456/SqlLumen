import type { ReactNode } from 'react'

interface FactProps {
  label: string
  htmlFor?: string
  labelId?: string
  error?: string
  children: ReactNode
}

function FactLabel({ label, htmlFor, labelId }: Omit<FactProps, 'children' | 'error'>) {
  if (htmlFor) {
    return (
      <label id={labelId} htmlFor={htmlFor}>
        {label}
      </label>
    )
  }
  return <span id={labelId}>{label}</span>
}

export function Fact({ label, htmlFor, labelId, error, children }: FactProps) {
  return (
    <>
      <dt className="flex min-h-8 items-center text-body text-light-on-surface-variant dark:text-dark-on-surface-variant">
        <FactLabel label={label} htmlFor={htmlFor} labelId={labelId} />
      </dt>
      <dd className="flex min-h-8 min-w-0 flex-col justify-center gap-1 text-body text-light-on-surface dark:text-dark-on-surface">
        <div className="flex min-w-0 items-center gap-2">{children}</div>
        {error && (
          <span className="text-caption text-light-error dark:text-dark-error">{error}</span>
        )}
      </dd>
    </>
  )
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="min-w-0 truncate font-mono text-mono">{children}</span>
}

export function Muted({ children }: { children: ReactNode }) {
  return (
    <span className="text-light-on-surface-variant dark:text-dark-on-surface-variant">
      {children}
    </span>
  )
}

export function MonoOrMuted({ value, fallback }: { value: string | null; fallback: string }) {
  if (!value) return <Muted>{fallback}</Muted>
  return <Mono>{value}</Mono>
}
