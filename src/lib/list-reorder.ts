export interface ListMove {
  sourceIndex: number
  insertIndex: number
}

export function clampedInsertIndex(insertIndex: number, itemCount: number): number {
  return Math.max(0, Math.min(insertIndex, itemCount))
}

function targetIndexAfterRemoval({ sourceIndex, insertIndex }: ListMove): number {
  return insertIndex > sourceIndex ? insertIndex - 1 : insertIndex
}

export function movedToInsertIndex<TItem>(items: TItem[], move: ListMove): TItem[] {
  const nextItems = [...items]
  const [movedItem] = nextItems.splice(move.sourceIndex, 1)
  nextItems.splice(targetIndexAfterRemoval(move), 0, movedItem)
  return nextItems
}
