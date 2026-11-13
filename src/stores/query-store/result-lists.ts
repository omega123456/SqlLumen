import { isIndexInBounds } from '../../lib/value-checks'
import type { SingleResultState, TabQueryState } from '../query-store'

export function isSameResultList(next: SingleResultState[], current: SingleResultState[]): boolean {
  return next.every((result, index) => result === current[index])
}

export function hasResults(tab: TabQueryState | undefined): tab is TabQueryState {
  if (!tab) return false
  return tab.results.length > 0
}

export function hasResultAt(
  tab: TabQueryState | undefined,
  resultIndex: number
): tab is TabQueryState {
  if (!tab) return false
  return isIndexInBounds(resultIndex, tab.results.length)
}

export function hasOpenExportDialog(tab: TabQueryState | undefined): boolean {
  if (!tab) return false
  return tab.results.some((result) => result.exportDialogOpen)
}
