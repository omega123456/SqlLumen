import type { ReactNode } from 'react'
import type { ForeignKeyInfo } from '../../types/schema'
import { SchemaCell, SchemaPanel, SchemaRow, SchemaTable } from './SchemaTableParts'

export interface ForeignKeysPanelProps {
  foreignKeys: ForeignKeyInfo[]
}

const FOREIGN_KEY_LABELS = [
  'Name',
  'Column',
  'Referenced table',
  'Referenced column',
  'On delete',
  'On update',
]

function MonoText({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-light-on-surface dark:text-dark-on-surface">{children}</span>
  )
}

function ReferentialAction({ children }: { children: ReactNode }) {
  return (
    <span className="text-size-caption font-semibold text-light-on-surface-variant dark:text-dark-on-surface-variant">
      {children}
    </span>
  )
}

export function ForeignKeysPanel({ foreignKeys }: ForeignKeysPanelProps) {
  if (foreignKeys.length === 0) {
    return (
      <SchemaPanel data-testid="foreign-keys-panel">
        <div className="flex items-center justify-center px-4 py-12">
          <p className="text-size-body text-light-on-surface-variant opacity-60 dark:text-dark-on-surface-variant wrap-break-word">
            No foreign keys defined on this table
          </p>
        </div>
      </SchemaPanel>
    )
  }

  return (
    <SchemaPanel data-testid="foreign-keys-panel">
      <SchemaTable columnLabels={FOREIGN_KEY_LABELS}>
        {foreignKeys.map((foreignKey) => (
          <SchemaRow key={`${foreignKey.name}:${foreignKey.columnName}`}>
            <SchemaCell>
              <span className="font-mono font-semibold text-light-on-surface dark:text-dark-on-surface">
                {foreignKey.name}
              </span>
            </SchemaCell>
            <SchemaCell>
              <MonoText>{foreignKey.columnName}</MonoText>
            </SchemaCell>
            <SchemaCell>
              <span className="font-mono font-semibold text-light-primary dark:text-dark-primary">
                {foreignKey.referencedTable}
              </span>
            </SchemaCell>
            <SchemaCell>
              <MonoText>{foreignKey.referencedColumn}</MonoText>
            </SchemaCell>
            <SchemaCell>
              <ReferentialAction>{foreignKey.onDelete}</ReferentialAction>
            </SchemaCell>
            <SchemaCell>
              <ReferentialAction>{foreignKey.onUpdate}</ReferentialAction>
            </SchemaCell>
          </SchemaRow>
        ))}
      </SchemaTable>
    </SchemaPanel>
  )
}
