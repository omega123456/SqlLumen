import type { ColumnInfo } from '../../types/schema'
import { DataTableContainer } from '../common/DataTableContainer'
import styles from './ColumnsPanel.module.css'

export interface ColumnsPanelProps {
  columns: ColumnInfo[]
}

/** Primary keys get the accent pill (prototype `.pill.acc`); other keys the neutral pill. */
function keyBadgeClass(columnKey: string): string {
  return columnKey === 'PRI' ? styles.keyPri : styles.keyOther
}

export function ColumnsPanel({ columns }: ColumnsPanelProps) {
  return (
    <div className={styles.container} data-testid="columns-panel">
      <DataTableContainer>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>Column</th>
              <th className={styles.th}>Type</th>
              <th className={styles.th}>Null</th>
              <th className={styles.th}>Key</th>
              <th className={styles.th}>Default</th>
              <th className={styles.th}>Extra</th>
            </tr>
          </thead>
          <tbody>
            {columns.map((col) => (
              <tr key={col.name} className={styles.row}>
                <td className={styles.td}>
                  <span className={styles.columnName}>{col.name}</span>
                </td>
                <td className={styles.td}>
                  <span className={styles.dataType}>{col.dataType}</span>
                </td>
                <td className={styles.td}>{col.nullable ? 'Yes' : 'No'}</td>
                <td className={styles.td}>
                  {col.columnKey ? (
                    <span className={`${styles.keyBadge} ${keyBadgeClass(col.columnKey)}`}>
                      {col.columnKey}
                    </span>
                  ) : (
                    <span className={styles.empty}>—</span>
                  )}
                </td>
                <td className={styles.td}>
                  <span
                    className={col.defaultValue != null ? styles.defaultValue : styles.nullValue}
                  >
                    {col.defaultValue != null ? col.defaultValue : 'NULL'}
                  </span>
                </td>
                <td className={styles.td}>
                  {col.extra ? (
                    <span className={styles.extra}>{col.extra}</span>
                  ) : (
                    <span className={styles.empty}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTableContainer>
    </div>
  )
}
