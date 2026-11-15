import type { ReactNode } from 'react'
import type { IndexInfo } from '../../types/schema'
import { SchemaCell, SchemaPanel, SchemaRow, SchemaTable } from './SchemaTableParts'

export interface IndexesPanelProps {
  indexes: IndexInfo[]
}

const INDEX_LABELS = ['Name', 'Type', 'Cardinality', 'Columns', 'Visible']
const PRIMARY_INDEX_NAME = 'PRIMARY'
const MISSING_VALUE_LABEL = '—'

function MutedText({ children }: { children: ReactNode }) {
  return (
    <span className="text-light-on-surface-variant dark:text-dark-on-surface-variant">
      {children}
    </span>
  )
}

function IndexBadge({ index }: { index: IndexInfo }) {
  if (index.name === PRIMARY_INDEX_NAME) {
    return (
      <span
        className="inline-flex size-4.5 items-center justify-center rounded-round bg-light-tertiary-container text-size-caption font-semibold text-light-tertiary dark:bg-dark-tertiary-container dark:text-dark-tertiary"
        aria-label="Primary key"
      >
        &#x2713;
      </span>
    )
  }
  if (!index.isUnique) return null
  return (
    <span className="inline-block rounded-control bg-light-surface-container-highest px-1.25 py-px text-size-caption font-semibold text-light-on-surface-variant dark:bg-dark-surface-container-highest dark:text-dark-on-surface-variant">
      UNI
    </span>
  )
}

function IndexColumnPills({ columns }: { columns: string[] }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {columns.map((column) => (
        <span
          key={column}
          className="inline-block rounded-control bg-light-surface-container-high px-2 py-0.5 font-mono text-size-caption font-regular text-light-on-surface dark:bg-dark-surface-container-high dark:text-dark-on-surface"
        >
          {column}
        </span>
      ))}
    </span>
  )
}

function cardinalityLabel(cardinality: number | null): string {
  if (cardinality == null) return MISSING_VALUE_LABEL
  return cardinality.toLocaleString()
}

export function IndexesPanel({ indexes }: IndexesPanelProps) {
  return (
    <SchemaPanel data-testid="indexes-panel">
      <SchemaTable columnLabels={INDEX_LABELS}>
        {indexes.map((index) => (
          <SchemaRow key={index.name}>
            <SchemaCell>
              <span className="inline-flex items-center gap-1.5 font-mono font-semibold text-light-on-surface dark:text-dark-on-surface">
                <IndexBadge index={index} />
                {index.name}
              </span>
            </SchemaCell>
            <SchemaCell>
              <MutedText>{index.indexType}</MutedText>
            </SchemaCell>
            <SchemaCell>
              <span className="font-mono text-light-on-surface dark:text-dark-on-surface">
                {cardinalityLabel(index.cardinality)}
              </span>
            </SchemaCell>
            <SchemaCell>
              <IndexColumnPills columns={index.columns} />
            </SchemaCell>
            <SchemaCell>
              <MutedText>{index.isVisible ? 'Yes' : 'No'}</MutedText>
            </SchemaCell>
          </SchemaRow>
        ))}
      </SchemaTable>
    </SchemaPanel>
  )
}
