import { columnKey } from './col-key-utils'

export type ResultRow = Record<string, unknown>

export const MATERIALIZER_MAX_ENTRIES = 6_000

export interface WindowRowMaterializer {
  get: (position: number, baseIndex: number, row: readonly unknown[]) => ResultRow
  reset: (columnCount: number) => void
}

interface Entry {
  row: readonly unknown[]
  position: number
  object: ResultRow
}

export interface RowMaterialization {
  position: number
  baseIndex: number
  row: readonly unknown[]
  columnCount: number
}

export function materializeRow({
  position,
  baseIndex,
  row,
  columnCount,
}: RowMaterialization): ResultRow {
  const object: ResultRow = { __rowIdx: position, __baseIdx: baseIndex }
  for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
    object[columnKey(columnIndex)] = row[columnIndex] ?? null
  }
  return object
}

export function toCachedRow(
  rowData: Record<string, unknown>,
  columnCount: number
): { row: unknown[]; baseIndex: number } {
  const baseIndex = typeof rowData.__baseIdx === 'number' ? rowData.__baseIdx : -1
  return {
    row: Array.from({ length: columnCount }, (_, index) => rowData[columnKey(index)] ?? null),
    baseIndex: baseIndex,
  }
}

function isSameEntry(
  entry: Entry | undefined,
  target: Pick<Entry, 'row' | 'position'>
): entry is Entry {
  if (!entry) return false
  return entry.row === target.row && entry.position === target.position
}

export function createWindowRowMaterializer(initialColumnCount = 0): WindowRowMaterializer {
  let columnCount = initialColumnCount
  let entries = new Map<number, Entry>()

  return {
    get(position, baseIndex, row) {
      const previous = entries.get(baseIndex)
      if (isSameEntry(previous, { row, position })) {
        return previous.object
      }
      const object = materializeRow({
        position: position,
        baseIndex: baseIndex,
        row: row,
        columnCount: columnCount,
      })
      const isNewEntryOverCapacity = !previous && entries.size >= MATERIALIZER_MAX_ENTRIES
      if (isNewEntryOverCapacity) {
        entries = new Map()
      }
      entries.set(baseIndex, { row, position, object })
      return object
    },
    reset(nextColumnCount) {
      columnCount = nextColumnCount
      entries = new Map()
    },
  }
}
