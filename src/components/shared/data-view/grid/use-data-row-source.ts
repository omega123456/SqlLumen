import { useMemo, useState } from 'react'
import {
  createWindowRowMaterializer,
  materializeRow,
  type ResultRow,
} from '../../../../lib/result-row-materializer'
import {
  getLoadedRow,
  readViewRange,
  requestVisibleRange,
  subscribeToResultWindow,
  type CachedRow,
} from '../../../../lib/result-window-cache'
import type {
  DataViewEditSession,
  DataViewSlot,
  DataViewSurfaceRef,
} from '../../../../stores/data-view/data-view-types'
import { DRAFT_ROW_BASE_INDEX } from '../../../../stores/data-view/data-view-selectors'
import type { GridRowSource, RowRange, RowSourceReadOptions } from '../../glide/grid-row-source'
import { isEditedRow, rekeyByBoundColumn } from './data-grid-model'

interface RowReaderInputs {
  tabId: string
  resultIndex: number
  columnCount: number
  viewRowCount: number
  edit: DataViewEditSession
  boundColumnIndexLookup: Map<string, number>
}

export interface DataRowSourceInputs {
  ref: DataViewSurfaceRef
  slot: DataViewSlot
  edit: DataViewEditSession
  boundColumnIndexLookup: Map<string, number>
}

type WindowRowMaterializer = ReturnType<typeof createWindowRowMaterializer>

class DataRowReader {
  constructor(
    private readonly inputs: RowReaderInputs,
    private readonly materializer: WindowRowMaterializer
  ) {}

  private withEditOverlay(row: ResultRow, position: number, baseIndex: number): ResultRow {
    const { edit, boundColumnIndexLookup } = this.inputs
    if (!edit.state) return row
    const isEditingRow = isEditedRow({ position: position, baseIndex: baseIndex }, edit)
    if (!isEditingRow) return row
    return { ...row, ...rekeyByBoundColumn(edit.state.currentValues, boundColumnIndexLookup) }
  }

  private draftRowAt(position: number): ResultRow | undefined {
    const { edit, columnCount } = this.inputs
    if (!edit.draftRow) return undefined
    const draft = materializeRow({
      position: position,
      baseIndex: DRAFT_ROW_BASE_INDEX,
      row: edit.draftRow,
      columnCount: columnCount,
    })
    return this.withEditOverlay(draft, position, DRAFT_ROW_BASE_INDEX)
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
    const { edit, viewRowCount } = this.inputs
    const reachesDraftRow = end > viewRowCount
    if (edit.draftRow && reachesDraftRow) {
      const draft = this.getRow(viewRowCount)
      if (draft) rows.push(draft)
    }
    return rows
  }
}

function toGridRowSource(reader: DataRowReader, inputs: RowReaderInputs) {
  const { tabId, resultIndex, viewRowCount, edit } = inputs
  const source: GridRowSource<ResultRow> = {
    kind: 'windowed',
    rowCount: viewRowCount + (edit.draftRow ? 1 : 0),
    getRow: (position) => reader.getRow(position),
    isLoaded: (position) => reader.getRow(position) !== undefined,
    onVisibleRangeChange: (range) => requestVisibleRange(tabId, resultIndex, range),
    subscribe: (listener) => subscribeToResultWindow(tabId, resultIndex, listener),
    readRange: (range, options) => reader.readRange(range, options),
  }
  return source
}

function useResettingMaterializer(slot: DataViewSlot) {
  const columnCount = slot.columns.length
  const [materializer] = useState(() => createWindowRowMaterializer(columnCount))
  const materializerKey = `${slot.queryId ?? ''}:${slot.viewVersion}:${columnCount}`
  const [lastMaterializerKey, setLastMaterializerKey] = useState(materializerKey)
  if (lastMaterializerKey !== materializerKey) {
    setLastMaterializerKey(materializerKey)
    materializer.reset(columnCount)
  }
  return { materializer, materializerKey }
}

export function useDataRowSource({
  ref,
  slot,
  edit,
  boundColumnIndexLookup,
}: DataRowSourceInputs): GridRowSource<ResultRow> {
  const { materializer, materializerKey } = useResettingMaterializer(slot)
  const { tabId, resultIndex } = ref
  const columnCount = slot.columns.length
  const viewRowCount = slot.viewRowCount
  return useMemo(() => {
    void materializerKey
    const readerInputs: RowReaderInputs = {
      tabId: tabId,
      resultIndex: resultIndex,
      columnCount: columnCount,
      viewRowCount: viewRowCount,
      edit: edit,
      boundColumnIndexLookup: boundColumnIndexLookup,
    }
    return toGridRowSource(new DataRowReader(readerInputs, materializer), readerInputs)
  }, [
    boundColumnIndexLookup,
    columnCount,
    edit,
    materializer,
    materializerKey,
    resultIndex,
    tabId,
    viewRowCount,
  ])
}
