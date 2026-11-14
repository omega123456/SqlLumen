import { CompactSelection, type GridSelection, type Rectangle } from '@glideapps/glide-data-grid'
import { resolveRowRange, type GridRowSource, type RowRange } from '../grid-row-source'
import type { GridRow, GridRowActions } from './canvas-grid-types'

export type RowProgress = ReturnType<GridRowActions['begin']>
export type MutableRowRange = [number, number]

export interface RowRangeLoadRequest {
  source: GridRowSource<GridRow>
  ranges: MutableRowRange[]
  signal: AbortSignal
  progress: RowProgress | undefined
}

export const ROW_FETCH_CHUNK = 2000
const VISIBLE_REPAINT_FALLBACK_ROWS = 200

function findAddedIndex(next: CompactSelection, previous: CompactSelection): number | undefined {
  for (const index of next) {
    if (!previous.hasIndex(index)) return index
  }
  return undefined
}

function contiguousSelectionRange(selection: CompactSelection): RowRange[] | null {
  const first = selection.first()
  const last = selection.last()
  if (first === undefined) return []
  if (last === undefined) return []
  const isContiguousRun = last - first + 1 === selection.length
  return isContiguousRun ? [[first, last + 1]] : null
}

function rangesFromIndexes(indexes: Iterable<number>): RowRange[] {
  const ranges: MutableRowRange[] = []
  for (const index of [...indexes].sort((left, right) => left - right)) {
    const current = ranges[ranges.length - 1]
    const extendsCurrentRange = current !== undefined && current[1] === index
    if (extendsCurrentRange) {
      current[1] = index + 1
      continue
    }
    ranges.push([index, index + 1])
  }
  return ranges
}

export function selectionRowRanges(selection: CompactSelection | Iterable<number>): RowRange[] {
  const isCompactSelection = selection instanceof CompactSelection
  const contiguous = isCompactSelection ? contiguousSelectionRange(selection) : null
  return contiguous ?? rangesFromIndexes(selection)
}

export function mergeRowRanges(ranges: readonly RowRange[], rowCount: number): MutableRowRange[] {
  const sorted = ranges
    .map(([start, end]): MutableRowRange => [Math.max(0, start), Math.min(rowCount, end)])
    .filter(([start, end]) => end > start)
    .sort((left, right) => left[0] - right[0])
  const merged: MutableRowRange[] = []
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1]
    const overlapsLastRange = last !== undefined && start <= last[1]
    if (overlapsLastRange) {
      last[1] = Math.max(last[1], end)
      continue
    }
    merged.push([start, end])
  }
  return merged
}

export function rectRowRanges(rects: readonly Rectangle[]): RowRange[] {
  return rects.map((rect) => [rect.y, rect.y + rect.height] as const)
}

function isRangeLoaded<TRow>(source: GridRowSource<TRow>, range: MutableRowRange): boolean {
  const [start, end] = range
  for (let index = start; index < end; index++) {
    if (!source.isLoaded(index)) return false
  }
  return true
}

export function hasUnloadedRange<TRow>(
  source: GridRowSource<TRow>,
  ranges: MutableRowRange[]
): boolean {
  return ranges.some((range) => !isRangeLoaded(source, range))
}

export async function loadRowRanges(request: RowRangeLoadRequest): Promise<Map<number, GridRow>> {
  const resolved = new Map<number, GridRow>()
  let doneBefore = 0
  for (const range of request.ranges) {
    const doneBeforeRange = doneBefore
    const rows = await resolveRowRange(request.source, range, {
      signal: request.signal,
      onProgress: ({ done }) => request.progress?.update(doneBeforeRange + done),
    })
    if (request.signal.aborted) throw new DOMException('Cancelled', 'AbortError')
    rows.forEach((row, offset) => resolved.set(range[0] + offset, row))
    doneBefore += range[1] - range[0]
    request.progress?.update(doneBefore)
  }
  return resolved
}

export function countRows(ranges: MutableRowRange[]): number {
  return ranges.reduce((sum, [start, end]) => sum + (end - start), 0)
}

export function countFetchChunks(ranges: MutableRowRange[]): number {
  return ranges.reduce((sum, [start, end]) => sum + Math.ceil((end - start) / ROW_FETCH_CHUNK), 0)
}

export function visibleRepaintRange(loadedRange: RowRange, region: Rectangle | null): RowRange {
  const [start, end] = loadedRange
  if (!region) return [start, Math.min(end, start + VISIBLE_REPAINT_FALLBACK_ROWS)]
  return [Math.max(start, region.y), Math.min(end, region.y + region.height)]
}

export function cellsInRowSpan(
  span: RowRange,
  columnCount: number
): Array<readonly [number, number]> {
  const [from, to] = span
  const cells: Array<readonly [number, number]> = []
  for (let row = from; row < to; row++) {
    for (let column = 0; column < columnCount; column++) cells.push([column, row])
  }
  return cells
}

function isSingleRowCheckAdded(next: CompactSelection, previous: CompactSelection): boolean {
  return next.length === previous.length + 1
}

export function withoutUnloadedRowCheck(
  selection: GridSelection,
  previousRows: CompactSelection,
  source: GridRowSource<GridRow>
): GridSelection {
  if (!isSingleRowCheckAdded(selection.rows, previousRows)) return selection
  const added = findAddedIndex(selection.rows, previousRows)
  if (added === undefined) return selection
  if (source.isLoaded(added)) return selection
  return { ...selection, rows: previousRows }
}

export function withoutCheckedRows(
  selection: GridSelection | undefined
): GridSelection | undefined {
  if (!selection) return selection
  const hasCheckedRows = selection.rows.length > 0
  if (!hasCheckedRows) return selection
  return { ...selection, rows: CompactSelection.empty() }
}

export function haveSameRowIndexes(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}
