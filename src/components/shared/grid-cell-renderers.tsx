import { joinClassNames } from '../../lib/class-names'
import { useSettingsStore } from '../../stores/settings-store'
import type { GridColumn } from './glide/glide-grid-types'
import { isBlobPlaceholderText } from '../../lib/blob-utils'
import { isNullish } from '../../lib/value-checks'

type CellValueKind = 'null' | 'blob' | 'text'

const CELL_VALUE_FRAME = 'block min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap'

const CELL_VALUE_CLASSES: Record<CellValueKind, string> = {
  null: joinClassNames([CELL_VALUE_FRAME, 'italic text-light-outline dark:text-dark-outline']),
  blob: joinClassNames([
    CELL_VALUE_FRAME,
    'italic opacity-60 text-light-on-surface-variant dark:text-dark-on-surface-variant',
  ]),
  text: CELL_VALUE_FRAME,
}

function renderCellValue(value: unknown): React.ReactNode {
  if (isNullish(value)) {
    const nullDisplay = useSettingsStore.getState().getSetting('results.nullDisplay')
    return (
      <span className={CELL_VALUE_CLASSES.null} data-value-kind="null">
        {nullDisplay}
      </span>
    )
  }

  if (isBlobPlaceholderText(value)) {
    return (
      <span className={CELL_VALUE_CLASSES.blob} data-value-kind="blob">
        {value}
      </span>
    )
  }

  return (
    <span className={CELL_VALUE_CLASSES.text} data-value-kind="text">
      {String(value)}
    </span>
  )
}

export function TableDataCellRenderer<R extends Record<string, unknown>>(props: {
  row: R
  column: GridColumn<R>
  rowIdx: number
}) {
  const value = props.row[props.column.key as keyof R]
  return renderCellValue(value)
}
