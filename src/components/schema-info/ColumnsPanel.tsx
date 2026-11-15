import type { ReactNode } from 'react'
import type { ColumnInfo } from '../../types/schema'
import { joinClassNames } from '../../lib/class-names'
import { SchemaCell, SchemaPanel, SchemaRow, SchemaTable } from './SchemaTableParts'

export interface ColumnsPanelProps {
  columns: ColumnInfo[]
}

const COLUMN_LABELS = ['Column', 'Type', 'Null', 'Key', 'Default', 'Extra']
const PRIMARY_KEY = 'PRI'

type KeyBadgeTone = 'primary' | 'other'

const KEY_BADGE_TONE_CLASSES: Record<KeyBadgeTone, string> = {
  primary:
    'bg-light-fill-accent-tint text-light-primary dark:bg-dark-fill-accent-tint dark:text-dark-primary',
  other:
    'bg-light-fill-neutral-selected text-light-on-surface-variant dark:bg-dark-fill-neutral-selected dark:text-dark-on-surface-variant',
}

function keyBadgeTone(columnKey: string): KeyBadgeTone {
  if (columnKey === PRIMARY_KEY) return 'primary'
  return 'other'
}

function KeyBadge({ columnKey }: { columnKey: string }) {
  const tone = keyBadgeTone(columnKey)
  return (
    <span
      className={joinClassNames([
        'inline-flex h-5 items-center rounded-key-badge px-2 text-size-key-hint font-semibold whitespace-nowrap',
        KEY_BADGE_TONE_CLASSES[tone],
      ])}
      data-tone={tone}
    >
      {columnKey}
    </span>
  )
}

type CellValueTone = 'name' | 'mono' | 'missing' | 'placeholder'

const CELL_VALUE_TONE_CLASSES: Record<CellValueTone, string> = {
  name: 'font-mono text-size-cell-mono font-semibold',
  mono: 'font-mono text-size-cell-mono',
  missing: 'font-mono text-size-cell-mono text-light-outline italic dark:text-dark-outline',
  placeholder: 'text-light-outline dark:text-dark-outline',
}

function CellValue({ tone, children }: { tone: CellValueTone; children: ReactNode }) {
  return <span className={CELL_VALUE_TONE_CLASSES[tone]}>{children}</span>
}

function OptionalCellValue({ value }: { value: string }) {
  if (!value) return <CellValue tone="placeholder">—</CellValue>
  return <CellValue tone="mono">{value}</CellValue>
}

function ColumnKeyCell({ columnKey }: { columnKey: string }) {
  if (!columnKey) return <CellValue tone="placeholder">—</CellValue>
  return <KeyBadge columnKey={columnKey} />
}

function DefaultValueCell({ defaultValue }: { defaultValue: string | null }) {
  if (defaultValue == null) return <CellValue tone="missing">NULL</CellValue>
  return <CellValue tone="mono">{defaultValue}</CellValue>
}

export function ColumnsPanel({ columns }: ColumnsPanelProps) {
  return (
    <SchemaPanel data-testid="columns-panel">
      <SchemaTable columnLabels={COLUMN_LABELS}>
        {columns.map((column) => (
          <SchemaRow key={column.name} hoverMotion="instant">
            <SchemaCell>
              <CellValue tone="name">{column.name}</CellValue>
            </SchemaCell>
            <SchemaCell>
              <CellValue tone="mono">{column.dataType}</CellValue>
            </SchemaCell>
            <SchemaCell>{column.nullable ? 'Yes' : 'No'}</SchemaCell>
            <SchemaCell>
              <ColumnKeyCell columnKey={column.columnKey} />
            </SchemaCell>
            <SchemaCell>
              <DefaultValueCell defaultValue={column.defaultValue} />
            </SchemaCell>
            <SchemaCell>
              <OptionalCellValue value={column.extra} />
            </SchemaCell>
          </SchemaRow>
        ))}
      </SchemaTable>
    </SchemaPanel>
  )
}
