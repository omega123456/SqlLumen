export interface SelectionResetState {
  resetKey: number
  prevCount: number
}

export function nextSelectionResetState(
  current: SelectionResetState,
  checkedRowCount: number
): SelectionResetState {
  const wasSelectionCleared = current.prevCount > 0 && checkedRowCount === 0
  return {
    resetKey: wasSelectionCleared ? current.resetKey + 1 : current.resetKey,
    prevCount: checkedRowCount,
  }
}
