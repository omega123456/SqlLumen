import { useCallback, useMemo, useState } from 'react'
import type { GridColumnDescriptor } from '../../../../types/shared-data-view'
import { buildGlideColumns } from '../glide-column-adapter'
import type { GridColumn } from '../glide-grid-types'
import type { CanvasBaseGridViewProps, GridBehaviourFlags, GridRow } from './canvas-grid-types'
import { toGridColumn } from './grid-columns'

interface GridColumnsInput {
  props: CanvasBaseGridViewProps
  flags: GridBehaviourFlags
  autoSizeSampleRows: readonly GridRow[]
}

type ColumnWidths = Record<string, number>

interface GridColumnsSpec {
  columns: GridColumnDescriptor[]
  autoSizeConfig: CanvasBaseGridViewProps['autoSizeConfig']
  prefixColumns: CanvasBaseGridViewProps['prefixColumns']
  suffixColumns: CanvasBaseGridViewProps['suffixColumns']
  hasExternalResize: boolean
  showInfoColumn: boolean
  autoSizeSampleRows: readonly GridRow[]
  internalColumnWidths: ColumnWidths
}

const INFO_COLUMN_WIDTH_PX = 260

const INFO_COLUMN: GridColumn<GridRow> = {
  key: 'info',
  name: 'Info',
  width: INFO_COLUMN_WIDTH_PX,
  resizable: true,
  sortable: true,
}

function withInternalWidth(column: GridColumn<GridRow>, widths: ColumnWidths): GridColumn<GridRow> {
  const width = widths[column.key]
  return typeof width === 'number' ? { ...column, width } : column
}

function buildGridColumns(spec: GridColumnsSpec): GridColumn<GridRow>[] {
  const dataColumns = spec.columns.map((column) =>
    toGridColumn(column, spec.autoSizeSampleRows, spec.autoSizeConfig)
  )
  const infoColumns = spec.showInfoColumn ? [INFO_COLUMN] : []
  const nextColumns = [
    ...(spec.prefixColumns ?? []),
    ...dataColumns,
    ...infoColumns,
    ...(spec.suffixColumns ?? []),
  ]
  if (spec.hasExternalResize) return nextColumns
  return nextColumns.map((column) => withInternalWidth(column, spec.internalColumnWidths))
}

function withColumnWidth(widths: ColumnWidths, columnKey: string, width: number): ColumnWidths {
  return widths[columnKey] === width ? widths : { ...widths, [columnKey]: width }
}

export function useGridColumns(input: GridColumnsInput) {
  const { columns, onColumnResize, autoSizeConfig, prefixColumns, suffixColumns } = input.props
  const { showInfoColumn, rowMarkers } = input.flags
  const { autoSizeSampleRows } = input
  const [internalColumnWidths, setInternalColumnWidths] = useState<ColumnWidths>({})

  const gridColumns = useMemo<GridColumn<GridRow>[]>(
    () =>
      buildGridColumns({
        columns: columns,
        autoSizeConfig: autoSizeConfig,
        prefixColumns: prefixColumns,
        suffixColumns: suffixColumns,
        hasExternalResize: onColumnResize !== undefined,
        showInfoColumn: showInfoColumn,
        autoSizeSampleRows: autoSizeSampleRows,
        internalColumnWidths: internalColumnWidths,
      }),
    [
      columns,
      internalColumnWidths,
      onColumnResize,
      autoSizeConfig,
      prefixColumns,
      suffixColumns,
      autoSizeSampleRows,
      showInfoColumn,
    ]
  )

  const glideColumns = useMemo(
    () => buildGlideColumns(gridColumns, { hasRowMarker: rowMarkers !== 'none' }),
    [gridColumns, rowMarkers]
  )

  const handleColumnResize = useCallback(
    (columnIndex: number, width: number) => {
      const column = gridColumns[columnIndex]
      if (!column) return
      if (!onColumnResize) {
        setInternalColumnWidths((current) => withColumnWidth(current, column.key, width))
      }
      onColumnResize?.(column.key, width)
    },
    [gridColumns, onColumnResize]
  )

  return { gridColumns, glideColumns, handleColumnResize }
}
