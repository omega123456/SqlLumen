import { joinClassNames } from './class-names'

export type StatusDotOutcome = 'ok' | 'error'

const STATUS_DOT_FRAME =
  'inline-grid place-items-center flex-none size-4 rounded-round text-light-surface dark:text-dark-surface text-size-glyph font-bold leading-flat'

const STATUS_DOT_CLASSES: Record<StatusDotOutcome, string> = {
  ok: joinClassNames([STATUS_DOT_FRAME, 'bg-light-tertiary dark:bg-dark-tertiary']),
  error: joinClassNames([STATUS_DOT_FRAME, 'bg-light-error dark:bg-dark-error']),
}

export function statusDotClassName(succeeded: boolean): string {
  const outcome: StatusDotOutcome = succeeded ? 'ok' : 'error'
  return STATUS_DOT_CLASSES[outcome]
}
