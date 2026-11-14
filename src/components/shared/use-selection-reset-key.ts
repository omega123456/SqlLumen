import { useState } from 'react'
import { nextSelectionResetState } from './selection-reset-state'

export function useSelectionResetKey(checkedRowCount: number): number {
  const [selectionResetState, setSelectionResetState] = useState({ resetKey: 0, prevCount: 0 })
  if (selectionResetState.prevCount !== checkedRowCount) {
    setSelectionResetState((current) => nextSelectionResetState(current, checkedRowCount))
  }
  return selectionResetState.resetKey
}
