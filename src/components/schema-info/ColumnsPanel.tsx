import type { ColumnInfo } from '../../types/schema'
import { DataTableContainer } from '../common/DataTableContainer'
import styles from './ColumnsPanel.module.css'

export interface ColumnsPanelProps {
  columns: ColumnInfo[]
}

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
            {columns.map((column) => (
              <tr key={column.name} className={styles.row}>
                <td className={styles.td}>
                  <span className={styles.columnName}>{column.name}</span>
                </td>
                <td className={styles.td}>
                  <span className={styles.dataType}>{column.dataType}</span>
                </td>
                <td className={styles.td}>{column.nullable ? 'Yes' : 'No'}</td>
                <td className={styles.td}>
                  {column.columnKey ? (
                    <span className={`${styles.keyBadge} ${keyBadgeClass(column.columnKey)}`}>
                      {column.columnKey}
                    </span>
                  ) : (
                    <span className={styles.empty}>—</span>
                  )}
                </td>
                <td className={styles.td}>
                  <span
                    className={column.defaultValue != null ? styles.defaultValue : styles.nullValue}
                  >
                    {column.defaultValue != null ? column.defaultValue : 'NULL'}
                  </span>
                </td>
                <td className={styles.td}>
                  {column.extra ? (
                    <span className={styles.extra}>{column.extra}</span>
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
