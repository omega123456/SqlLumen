import type { ViewRange } from './result-window-cache'

export function countRanges(ranges: readonly ViewRange[]): number {
  return ranges.reduce((sum, [start, end]) => sum + Math.max(0, end - start), 0)
}

export function firstRangeStart(ranges: readonly ViewRange[]): number | null {
  const firstNonEmptyRange = ranges.find(([start, end]) => end > start)
  return firstNonEmptyRange ? firstNonEmptyRange[0] : null
}
