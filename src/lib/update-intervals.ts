import { milliseconds } from 'date-fns'

export const UPDATE_INTERVAL_OPTIONS = [
  { value: '1h', label: 'Every hour', ms: milliseconds({ hours: 1 }) },
  { value: '5h', label: 'Every 5 hours', ms: milliseconds({ hours: 5 }) },
  { value: '1d', label: 'Every day', ms: milliseconds({ days: 1 }) },
  { value: '7d', label: 'Every 7 days', ms: milliseconds({ days: 7 }) },
  { value: 'off', label: 'Off', ms: null },
] as const

export const DEFAULT_UPDATE_INTERVAL = UPDATE_INTERVAL_OPTIONS[2].value

export const UPDATE_INTERVAL_MS = Object.fromEntries(
  UPDATE_INTERVAL_OPTIONS.filter((option) => option.ms !== null).map((option) => [
    option.value,
    option.ms,
  ])
) as Record<Exclude<(typeof UPDATE_INTERVAL_OPTIONS)[number]['value'], 'off'>, number>
