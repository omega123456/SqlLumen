/**
 * FkCellRenderer — custom cell renderer for FK columns.
 *
 * Displays the cell value (via shared renderCellValue helper for NULL/BLOB
 * indicators) plus a trigger button (DotsThree icon) that opens the FK
 * lookup dialog. The trigger button visibility is controlled by CSS rules
 * in data-grid-precision.css using the [data-fk-trigger] attribute selector.
 *
 * The foreignKey metadata is passed through as a custom property on the
 * RDG column definition object. Access it by casting the column.
 */

import type { RenderCellProps } from 'react-data-grid'
import { renderCellValue } from './grid-cell-renderers'
import { FkLookupTriggerButton } from './FkLookupTriggerButton'
import type { ForeignKeyColumnInfo } from '../../types/schema'
import styles from './FkCellRenderer.module.css'

// ---------------------------------------------------------------------------
// Extended column type to access FK info passed through RDG column definition
// ---------------------------------------------------------------------------

interface GridColumn {
  foreignKey?: ForeignKeyColumnInfo
}

// ---------------------------------------------------------------------------
// FkCellRenderer
// ---------------------------------------------------------------------------

/**
 * Cell renderer for foreign key columns. Shows the cell value with
 * NULL/BLOB display logic (via shared renderCellValue helper) plus an
 * absolutely-positioned trigger button for FK lookup.
 */
export function FkCellRenderer<R extends Record<string, unknown>>(props: RenderCellProps<R>) {
  const { column, row } = props
  const value = row[column.key as keyof R]
  const foreignKey = (column as unknown as GridColumn).foreignKey

  return (
    <div style={{ position: 'relative', height: '100%', display: 'flex', alignItems: 'center' }}>
      {renderCellValue(value)}
      {foreignKey && (
        <FkLookupTriggerButton
          foreignKey={foreignKey}
          columnKey={column.key}
          currentValue={value}
          rowData={row as Record<string, unknown>}
          className={styles.triggerButton}
        />
      )}
    </div>
  )
}
