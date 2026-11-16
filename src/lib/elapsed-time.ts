import {
  hoursToMinutes,
  millisecondsToHours,
  millisecondsToMinutes,
  millisecondsToSeconds,
  milliseconds,
  minutesToSeconds,
} from 'date-fns'

const ONE_SECOND_MS = milliseconds({ seconds: 1 })

export interface ElapsedParts {
  hours: number
  minutesOfHour: number
  totalMinutes: number
  secondsOfMinute: number
}

export function elapsedParts(ms: number): ElapsedParts {
  const elapsedMs = Math.max(0, ms)
  const hours = millisecondsToHours(elapsedMs)
  const totalMinutes = millisecondsToMinutes(elapsedMs)
  const totalSeconds = millisecondsToSeconds(elapsedMs)
  return {
    hours: hours,
    minutesOfHour: totalMinutes - hoursToMinutes(hours),
    totalMinutes: totalMinutes,
    secondsOfMinute: totalSeconds - minutesToSeconds(totalMinutes),
  }
}

export function formatElapsedTime(ms: number): string {
  const { hours, minutesOfHour, secondsOfMinute } = elapsedParts(ms)

  if (hours > 0) return `${hours}h ${minutesOfHour}m ${secondsOfMinute}s`
  if (minutesOfHour > 0) return `${minutesOfHour}m ${secondsOfMinute}s`
  return `${secondsOfMinute}s`
}

interface DurationUnits {
  milliseconds: string
  seconds: string
}

const COMPACT_DURATION_UNITS: DurationUnits = { milliseconds: 'ms', seconds: 's' }
const SPACED_DURATION_UNITS: DurationUnits = { milliseconds: ' ms', seconds: ' s' }

function formatDurationWithUnits(ms: number, units: DurationUnits): string {
  if (ms < ONE_SECOND_MS) return `${ms}${units.milliseconds}`
  return `${(ms / ONE_SECOND_MS).toFixed(1)}${units.seconds}`
}

export function formatCompactDuration(ms: number): string {
  return formatDurationWithUnits(ms, COMPACT_DURATION_UNITS)
}

export function formatSpacedDuration(ms: number): string {
  return formatDurationWithUnits(ms, SPACED_DURATION_UNITS)
}
