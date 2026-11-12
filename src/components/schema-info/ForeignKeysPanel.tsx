import type { ForeignKeyInfo } from '../../types/schema'
import { DataTableContainer } from '../common/DataTableContainer'
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
      <DataTableContainer>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>Name</th>
              <th className={styles.th}>Column</th>
              <th className={styles.th}>Referenced table</th>
              <th className={styles.th}>Referenced column</th>
              <th className={styles.th}>On delete</th>
              <th className={styles.th}>On update</th>
            </tr>
          </thead>
          <tbody>
            {foreignKeys.map((foreignKey) => (
              <tr key={`${foreignKey.name}:${foreignKey.columnName}`} className={styles.row}>
                <td className={styles.td}>
                  <span className={styles.fkName}>{foreignKey.name}</span>
                </td>
                <td className={styles.td}>
                  <span className={styles.columnRef}>{foreignKey.columnName}</span>
                </td>
                <td className={styles.td}>
                  <span className={styles.refTable}>{foreignKey.referencedTable}</span>
                </td>
                <td className={styles.td}>
                  <span className={styles.columnRef}>{foreignKey.referencedColumn}</span>
                </td>
                <td className={styles.td}>
                  <span className={styles.action}>{foreignKey.onDelete}</span>
                </td>
                <td className={styles.td}>
                  <span className={styles.action}>{foreignKey.onUpdate}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTableContainer>
    </div>
  )
}
