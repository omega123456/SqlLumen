import { describe, expect, it, vi } from 'vitest'
import {
  createArrayRowSource,
  resolveRowRange,
  type GridRowSource,
} from '../../../../components/shared/glide/grid-row-source'

type Row = { id: number }

function windowedSource(loaded: Set<number>, rowCount: number): GridRowSource<Row> {
  return {
    kind: 'windowed',
    rowCount,
    getRow: (index) => (loaded.has(index) ? { id: index } : undefined),
    isLoaded: (index) => loaded.has(index),
    readRange: vi.fn(async ([start, end]) =>
      Array.from({ length: end - start }, (_, offset) => ({ id: start + offset }))
    ),
  }
}

describe('createArrayRowSource', () => {
  it('serves every row of the array and reports them loaded', () => {
    const rows = [{ id: 1 }, { id: 2 }]
    const source = createArrayRowSource(rows)
    expect(source.kind).toBe('array')
    expect(source.rowCount).toBe(2)
    expect(source.getRow(1)).toBe(rows[1])
    expect(source.getRow(5)).toBeUndefined()
    expect(source.isLoaded(0)).toBe(true)
    expect(source.isLoaded(-1)).toBe(false)
    expect(source.isLoaded(2)).toBe(false)
  })
})

describe('resolveRowRange', () => {
  it('returns loaded rows without fetching', async () => {
    const source = windowedSource(new Set([0, 1, 2]), 10)
    await expect(resolveRowRange(source, [0, 3])).resolves.toEqual([
      { id: 0 },
      { id: 1 },
      { id: 2 },
    ])
    expect(source.readRange).not.toHaveBeenCalled()
  })

  it('reads the whole clamped range when any row is missing', async () => {
    const source = windowedSource(new Set([0]), 4)
    const options = { onProgress: vi.fn() }
    await expect(resolveRowRange(source, [-2, 9], options)).resolves.toHaveLength(4)
    expect(source.readRange).toHaveBeenCalledWith([0, 4], options)
  })

  it('fails when rows are missing and the source cannot fetch', async () => {
    const source: GridRowSource<Row> = { ...windowedSource(new Set(), 3), readRange: undefined }
    await expect(resolveRowRange(source, [0, 2])).rejects.toThrow(/cannot fetch/)
  })
})
