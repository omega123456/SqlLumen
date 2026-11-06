/**
 * Test adapter for `ResultGridView`, whose rows are windowed (read from the
 * real page cache through a row source). Tests describe a result by its
 * `rows`; the adapter seeds the page cache with them (identity view, base
 * indices 0..n-1, so the editing base index defaults to the editing row) and
 * renders the windowed props.
 */
import { useLayoutEffect, type ComponentProps } from 'react'
import { ResultGridView } from '../../components/query-editor/ResultGridView'
import { seedResultWindow } from '../../lib/result-window-cache'
import type { GridRowSource } from '../../components/shared/glide/grid-row-source'

type WindowedProps = ComponentProps<typeof ResultGridView>

export type LegacyResultGridViewProps = Omit<
  WindowedProps,
  'resultIndex' | 'queryId' | 'viewRowCount' | 'viewVersion' | 'draftRow' | 'editingBaseIndex'
> & {
  rows: unknown[][]
  draftRow?: unknown[] | null
  editingBaseIndex?: number | null
}

export const LEGACY_GRID_QUERY_ID = 'q-grid'

export function LegacyResultGridView({
  rows,
  draftRow = null,
  editingBaseIndex,
  ...props
}: LegacyResultGridViewProps) {
  useLayoutEffect(() => {
    seedResultWindow({
      connectionId: 'conn-1',
      tabId: props.tabId,
      resultIndex: 0,
      queryId: LEGACY_GRID_QUERY_ID,
      viewVersion: 1,
      viewRowCount: rows.length,
      columns: props.columns,
      window: { offset: 0, rows, baseIndices: rows.map((_, index) => index) },
    })
  }, [props.columns, props.tabId, rows])
  return (
    <ResultGridView
      {...props}
      resultIndex={0}
      queryId={LEGACY_GRID_QUERY_ID}
      viewRowCount={rows.length}
      viewVersion={1}
      draftRow={draftRow}
      editingBaseIndex={
        editingBaseIndex !== undefined
          ? editingBaseIndex
          : props.editingRowIndex !== null &&
              props.editingRowIndex !== undefined &&
              props.editingRowIndex < rows.length
            ? props.editingRowIndex
            : null
      }
    />
  )
}

/** All rows a captured grid row source serves (loaded rows; undefined when not loaded). */
// eslint-disable-next-line react-refresh/only-export-components
export function rowsFromSource(
  source: GridRowSource<Record<string, unknown>> | undefined
): Array<Record<string, unknown>> {
  if (!source) return []
  return Array.from({ length: source.rowCount }, (_, index) => source.getRow(index)!)
}
