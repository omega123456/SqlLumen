import type { ColumnInfo } from '../../types/schema'
import styles from './ColumnsPanel.module.css'

export interface ColumnsPanelProps {
  columns: ColumnInfo[]
}

function keyBadgeClass(columnKey: string): string | undefined {
  switch (columnKey) {
    case 'PRI':
      return styles.keyPri
    case 'MUL':
      return styles.keyMul
    case 'UNI':
      return styles.keyUni
    default:
      return undefined
  }
}

export function ColumnsPanel({ columns }: ColumnsPanelProps) {
  return (
    <div className={styles.container} data-testid="columns-panel">
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
              <td className={styles.td}>
                <span className={col.nullable ? styles.nullYes : styles.nullNo}>
                  {col.nullable ? 'YES' : 'NO'}
                </span>
              </td>
              <td className={styles.td}>
                {col.columnKey ? (
                  <span className={`${styles.keyBadge} ${keyBadgeClass(col.columnKey) ?? ''}`}>
                    {col.columnKey}
                  </span>
                ) : (
                  <span className={styles.empty}>—</span>
                )}
              </td>
              <td className={styles.td}>
                <span className={col.defaultValue != null ? styles.defaultValue : styles.nullValue}>
                  {col.defaultValue != null ? col.defaultValue : 'NULL'}
                </span>
              </td>
              <td className={styles.td}>
                <span className={styles.extra}>{col.extra || '—'}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
