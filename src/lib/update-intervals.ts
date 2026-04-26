export const UPDATE_INTERVAL_OPTIONS = [
  { value: '1h', label: 'Every hour', ms: 3_600_000 },
  { value: '5h', label: 'Every 5 hours', ms: 18_000_000 },
  { value: '1d', label: 'Every day', ms: 86_400_000 },
  { value: '7d', label: 'Every 7 days', ms: 604_800_000 },
  { value: 'off', label: 'Off', ms: null },
] as const

export const DEFAULT_UPDATE_INTERVAL = UPDATE_INTERVAL_OPTIONS[2].value

export const UPDATE_INTERVAL_MS = Object.fromEntries(
  UPDATE_INTERVAL_OPTIONS.filter((option) => option.ms !== null).map((option) => [
    option.value,
    option.ms,
  ])
) as Record<Exclude<(typeof UPDATE_INTERVAL_OPTIONS)[number]['value'], 'off'>, number>
