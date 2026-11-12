import type { IndexInfo } from '../../types/schema'
import { DataTableContainer } from '../common/DataTableContainer'
import styles from './IndexesPanel.module.css'

export interface IndexesPanelProps {
  indexes: IndexInfo[]
}

export function IndexesPanel({ indexes }: IndexesPanelProps) {
  return (
    <div className={styles.container} data-testid="indexes-panel">
      <DataTableContainer>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>Name</th>
              <th className={styles.th}>Type</th>
              <th className={styles.th}>Cardinality</th>
              <th className={styles.th}>Columns</th>
              <th className={styles.th}>Visible</th>
            </tr>
          </thead>
          <tbody>
            {indexes.map((index) => (
              <tr key={index.name} className={styles.row}>
                <td className={styles.td}>
                  <span className={styles.indexName}>
                    {index.name === 'PRIMARY' && (
                      <span className={styles.primaryBadge} aria-label="Primary key">
                        &#x2713;
                      </span>
                    )}
                    {index.isUnique && index.name !== 'PRIMARY' && (
                      <span className={styles.uniqueBadge}>UNI</span>
                    )}
                    {index.name}
                  </span>
                </td>
                <td className={styles.td}>
                  <span className={styles.indexType}>{index.indexType}</span>
                </td>
                <td className={styles.td}>
                  <span className={styles.cardinality}>
                    {index.cardinality != null ? index.cardinality.toLocaleString() : '—'}
                  </span>
                </td>
                <td className={styles.td}>
                  <span className={styles.columnPills}>
                    {index.columns.map((column) => (
                      <span key={column} className={styles.columnPill}>
                        {column}
                      </span>
                    ))}
                  </span>
                </td>
                <td className={styles.td}>
                  <span className={styles.visible}>{index.isVisible ? 'Yes' : 'No'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTableContainer>
    </div>
  )
}
