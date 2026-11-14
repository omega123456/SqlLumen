import { useMemo } from 'react'
import { AUTO_SIZE_SAMPLE_LIMIT } from '../../../../lib/grid-column-style'
import { createArrayRowSource, type GridRowSource } from '../grid-row-source'
import type { CanvasBaseGridViewProps, GridRow } from './canvas-grid-types'

export interface GridRowData {
  source: GridRowSource<GridRow>
  isWindowed: boolean
  rowCount: number
  autoSizeSampleRows: readonly GridRow[]
}

function sampleLoadedRows(source: GridRowSource<GridRow>): GridRow[] {
  const sample: GridRow[] = []
  const sampleRowCount = Math.min(source.rowCount, AUTO_SIZE_SAMPLE_LIMIT)
  for (let index = 0; index < sampleRowCount; index++) {
    const row = source.getRow(index)
    if (!row) break
    sample.push(row)
  }
  return sample
}

export function useGridRowData(props: CanvasBaseGridViewProps): GridRowData {
  const { rows: rowsProp, rowSource } = props
  const source = useMemo<GridRowSource<GridRow>>(
    () => rowSource ?? createArrayRowSource(rowsProp),
    [rowSource, rowsProp]
  )
  const isWindowed = source.kind === 'windowed'
  const autoSizeSampleRows = useMemo<readonly GridRow[]>(
    () => (isWindowed ? sampleLoadedRows(source) : rowsProp),
    [isWindowed, rowsProp, source]
  )
  return {
    source: source,
    isWindowed: isWindowed,
    rowCount: source.rowCount,
    autoSizeSampleRows: autoSizeSampleRows,
  }
}
