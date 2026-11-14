import { useSettingsStore } from '../../stores/settings-store'
import type { GridColumn } from './glide/glide-grid-types'
import { isBlobPlaceholderText } from '../../lib/blob-utils'
import { isNullish } from '../../lib/value-checks'

function renderCellValue(value: unknown): React.ReactNode {
  if (isNullish(value)) {
    const nullDisplay = useSettingsStore.getState().getSetting('results.nullDisplay')
    return <span className="td-cell-value td-null-value">{nullDisplay}</span>
  }

  if (isBlobPlaceholderText(value)) {
    return <span className="td-cell-value td-blob-value">{value}</span>
  }

  return <span className="td-cell-value">{String(value)}</span>
}

export function TableDataCellRenderer<R extends Record<string, unknown>>(props: {
  row: R
  column: GridColumn<R>
  rowIdx: number
}) {
  const value = props.row[props.column.key as keyof R]
  return renderCellValue(value)
}
