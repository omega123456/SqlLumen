import type { ForeignKeyInfo } from '../../types/schema'
import styles from './ForeignKeysPanel.module.css'

export interface ForeignKeysPanelProps {
  foreignKeys: ForeignKeyInfo[]
}

export function ForeignKeysPanel({ foreignKeys }: ForeignKeysPanelProps) {
  if (foreignKeys.length === 0) {
    return (
      <div className={styles.container} data-testid="foreign-keys-panel">
        <div className={styles.emptyState}>
          <p className={styles.emptyText}>No foreign keys defined on this table</p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container} data-testid="foreign-keys-panel">
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.th}>Name</th>
            <th className={styles.th}>Column</th>
            <th className={styles.th}>Referenced Table</th>
            <th className={styles.th}>Referenced Column</th>
            <th className={styles.th}>On Delete</th>
            <th className={styles.th}>On Update</th>
          </tr>
        </thead>
        <tbody>
          {foreignKeys.map((fk) => (
            <tr key={`${fk.name}:${fk.columnName}`} className={styles.row}>
              <td className={styles.td}>
                <span className={styles.fkName}>{fk.name}</span>
              </td>
              <td className={styles.td}>
                <span className={styles.columnRef}>{fk.columnName}</span>
              </td>
              <td className={styles.td}>
                <span className={styles.refTable}>{fk.referencedTable}</span>
              </td>
              <td className={styles.td}>
                <span className={styles.columnRef}>{fk.referencedColumn}</span>
              </td>
              <td className={styles.td}>
                <span className={styles.action}>{fk.onDelete}</span>
              </td>
              <td className={styles.td}>
                <span className={styles.action}>{fk.onUpdate}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
