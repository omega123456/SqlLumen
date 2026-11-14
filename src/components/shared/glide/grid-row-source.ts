export interface RowSourceReadProgress {
  done: number
  total: number
}

export interface RowSourceReadOptions {
  signal?: AbortSignal
  onProgress?: (progress: RowSourceReadProgress) => void
}

export type RowRange = readonly [start: number, end: number]

export interface GridRowSource<TRow> {
  readonly kind: 'array' | 'windowed'
  readonly rowCount: number
  getRow(index: number): TRow | undefined
  isLoaded(index: number): boolean
  onVisibleRangeChange?(range: RowRange): void
  readRange?(range: RowRange, options?: RowSourceReadOptions): Promise<TRow[]>
  subscribe?(listener: (range: RowRange, info?: { reseeded: boolean }) => void): () => void
}

export function createArrayRowSource<TRow>(rows: readonly TRow[]): GridRowSource<TRow> {
  return {
    kind: 'array',
    rowCount: rows.length,
    getRow: (index) => rows[index],
    isLoaded: (index) => index >= 0 && index < rows.length,
  }
}

export async function resolveRowRange<TRow>(
  source: GridRowSource<TRow>,
  range: RowRange,
  options?: RowSourceReadOptions
): Promise<TRow[]> {
  const [start, end] = range
  const clampedStart = Math.max(0, start)
  const clampedEnd = Math.min(source.rowCount, end)
  const rows: TRow[] = []
  let allLoaded = true
  for (let index = clampedStart; index < clampedEnd; index++) {
    const row = source.getRow(index)
    if (row === undefined) {
      allLoaded = false
      break
    }
    rows.push(row)
  }
  if (allLoaded) return rows
  if (!source.readRange) {
    throw new Error('Rows are not loaded and the row source cannot fetch them')
  }
  return source.readRange([clampedStart, clampedEnd], options)
}
