import { useMemo, useState } from 'react'
import {
  createWindowRowMaterializer,
  materializeRow,
  type ResultRow,
} from '../../../lib/result-row-materializer'
import {
  getLoadedRow,
  readViewRange,
  requestVisibleRange,
  subscribeToResultWindow,
  type CachedRow,
} from '../../../lib/result-window-cache'
import type { RowEditState } from '../../../types/schema'
import type {
  GridRowSource,
  RowRange,
  RowSourceReadOptions,
} from '../../shared/glide/grid-row-source'
import { rekeyByBoundColumn } from './result-grid-model'

const DRAFT_BASE_INDEX = -1

interface RowReaderInputs {
  tabId: string
  resultIndex: number
  columnCount: number
  viewRowCount: number
  draftRow: unknown[] | null
  editState: RowEditState | null
  editingRowIndex: number | null
  editingBaseIndex: number | null
  boundColumnIndexLookup: Map<string, number>
}

export interface ResultRowSourceInputs extends RowReaderInputs {
  queryId: string | null
  viewVersion: number
}

type WindowRowMaterializer = ReturnType<typeof createWindowRowMaterializer>

class ResultRowReader {
  constructor(
    private readonly inputs: RowReaderInputs,
    private readonly materializer: WindowRowMaterializer
  ) {}

  private isEditingRow(position: number, baseIndex: number): boolean {
    const { editState, editingBaseIndex, editingRowIndex } = this.inputs
    if (editState === null) return false
    if (baseIndex >= 0) return baseIndex === editingBaseIndex
    return position === editingRowIndex
  }

  private withEditOverlay(row: ResultRow, position: number, baseIndex: number): ResultRow {
    const { editState, boundColumnIndexLookup } = this.inputs
    if (!editState) return row
    if (!this.isEditingRow(position, baseIndex)) return row
    return { ...row, ...rekeyByBoundColumn(editState.currentValues, boundColumnIndexLookup) }
  }

  private draftRowAt(position: number): ResultRow | undefined {
    const { draftRow, columnCount } = this.inputs
    if (!draftRow) return undefined
    const draft = materializeRow({
      position: position,
      baseIndex: DRAFT_BASE_INDEX,
      row: draftRow,
      columnCount: columnCount,
    })
    return this.withEditOverlay(draft, position, DRAFT_BASE_INDEX)
  }

  getRow(position: number): ResultRow | undefined {
    const { tabId, resultIndex, viewRowCount } = this.inputs
    if (position === viewRowCount) {
      const draft = this.draftRowAt(position)
      if (draft) return draft
    }
    const cached = getLoadedRow(tabId, resultIndex, position)
    if (!cached) return undefined
    const row = this.materializer.get(position, cached.baseIndex, cached.row)
    return this.withEditOverlay(row, position, cached.baseIndex)
  }

  private materializeFetched(cached: CachedRow, position: number): ResultRow {
    const row = materializeRow({
      position: position,
      baseIndex: cached.baseIndex,
      row: cached.row,
      columnCount: this.inputs.columnCount,
    })
    return this.withEditOverlay(row, position, cached.baseIndex)
  }

  private async fetchViewRows([start, end]: RowRange, options: RowSourceReadOptions | undefined) {
    const { tabId, resultIndex, viewRowCount } = this.inputs
    const viewEnd = Math.min(end, viewRowCount)
    if (viewEnd <= start) return []
    return readViewRange({
      tabId: tabId,
      resultIndex: resultIndex,
      range: [start, viewEnd],
      options: options,
    })
  }

  async readRange(
    range: RowRange,
    options: RowSourceReadOptions | undefined
  ): Promise<ResultRow[]> {
    const [start, end] = range
    const fetched = await this.fetchViewRows(range, options)
    const rows = fetched.map((cached, offset) => this.materializeFetched(cached, start + offset))
    const { draftRow, viewRowCount } = this.inputs
    const reachesDraftRow = end > viewRowCount
    if (draftRow && reachesDraftRow) {
      const draft = this.getRow(viewRowCount)
      if (draft) rows.push(draft)
    }
    return rows
  }
}

function toGridRowSource(reader: ResultRowReader, inputs: RowReaderInputs) {
  const { tabId, resultIndex, viewRowCount, draftRow } = inputs
  const source: GridRowSource<ResultRow> = {
    kind: 'windowed',
    rowCount: viewRowCount + (draftRow ? 1 : 0),
    getRow: (position) => reader.getRow(position),
    isLoaded: (position) => reader.getRow(position) !== undefined,
    onVisibleRangeChange: (range) => requestVisibleRange(tabId, resultIndex, range),
    subscribe: (listener) => subscribeToResultWindow(tabId, resultIndex, listener),
    readRange: (range, options) => reader.readRange(range, options),
  }
  return source
}

function useResettingMaterializer(inputs: ResultRowSourceInputs) {
  const { queryId, viewVersion, columnCount } = inputs
  const [materializer] = useState(() => createWindowRowMaterializer(columnCount))
  const materializerKey = `${queryId ?? ''}:${viewVersion}:${columnCount}`
  const [lastMaterializerKey, setLastMaterializerKey] = useState(materializerKey)
  if (lastMaterializerKey !== materializerKey) {
    setLastMaterializerKey(materializerKey)
    materializer.reset(columnCount)
  }
  return { materializer, materializerKey }
}

export function useResultRowSource(inputs: ResultRowSourceInputs): GridRowSource<ResultRow> {
  const { materializer, materializerKey } = useResettingMaterializer(inputs)
  const {
    tabId,
    resultIndex,
    columnCount,
    viewRowCount,
    draftRow,
    editState,
    editingRowIndex,
    editingBaseIndex,
    boundColumnIndexLookup,
  } = inputs
  return useMemo(() => {
    void materializerKey
    const readerInputs: RowReaderInputs = {
      tabId: tabId,
      resultIndex: resultIndex,
      columnCount: columnCount,
      viewRowCount: viewRowCount,
      draftRow: draftRow,
      editState: editState,
      editingRowIndex: editingRowIndex,
      editingBaseIndex: editingBaseIndex,
      boundColumnIndexLookup: boundColumnIndexLookup,
    }
    return toGridRowSource(new ResultRowReader(readerInputs, materializer), readerInputs)
  }, [
    boundColumnIndexLookup,
    columnCount,
    draftRow,
    editState,
    editingBaseIndex,
    editingRowIndex,
    materializer,
    materializerKey,
    resultIndex,
    tabId,
    viewRowCount,
  ])
}
