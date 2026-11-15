import { getTemporalColumnType } from './date-utils'
import { isJsonSqlType, isNumericSqlType, isStringishPrimarySqlType } from './grid-column-style'

export type GridCellKind = 'monoMuted' | 'mono' | 'json' | 'primaryText' | 'text'

const CELL_BODY_TEXT =
  'font-body text-size-row font-regular text-light-on-surface dark:text-dark-on-surface'

const GRID_CELL_CLASSES: Record<GridCellKind, string> = {
  monoMuted:
    'font-mono text-size-mono text-light-on-surface-variant dark:text-dark-on-surface-variant',
  mono: 'font-mono text-size-mono text-light-on-surface dark:text-dark-on-surface',
  json: CELL_BODY_TEXT,
  primaryText: 'font-body text-size-row font-regular text-light-primary dark:text-dark-primary',
  text: CELL_BODY_TEXT,
}

export function getGridCellKind(
  columnName: string,
  dataType: string,
  primaryKeyColumnNames?: string[]
): GridCellKind {
  if (isNumericSqlType(dataType)) return 'monoMuted'
  if (primaryKeyColumnNames?.includes(columnName)) return 'monoMuted'
  if (getTemporalColumnType(dataType)) return 'mono'
  if (isJsonSqlType(dataType)) return 'json'
  if (isStringishPrimarySqlType(dataType)) return 'primaryText'
  return 'text'
}

export function getGridCellClass(
  columnName: string,
  dataType: string,
  primaryKeyColumnNames?: string[]
): string {
  return GRID_CELL_CLASSES[getGridCellKind(columnName, dataType, primaryKeyColumnNames)]
}
