import type { IndexInfo } from '../../types/schema'
import styles from './IndexesPanel.module.css'

export interface IndexesPanelProps {
  indexes: IndexInfo[]
}

export function IndexesPanel({ indexes }: IndexesPanelProps) {
  return (
    <div className={styles.container} data-testid="indexes-panel">
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.th}>Index Name</th>
            <th className={styles.th}>Type</th>
            <th className={styles.th}>Cardinality</th>
            <th className={styles.th}>Columns</th>
            <th className={styles.th}>Visible</th>
          </tr>
        </thead>
        <tbody>
          {indexes.map((idx) => (
            <tr key={idx.name} className={styles.row}>
              <td className={styles.td}>
                <span className={styles.indexName}>
                  {idx.name === 'PRIMARY' && (
                    <span className={styles.primaryBadge} aria-label="Primary key">
                      &#x2713;
                    </span>
                  )}
                  {idx.isUnique && idx.name !== 'PRIMARY' && (
                    <span className={styles.uniqueBadge}>UNI</span>
                  )}
                  {idx.name}
                </span>
              </td>
              <td className={styles.td}>
                <span className={styles.indexType}>{idx.indexType}</span>
              </td>
              <td className={styles.td}>
                <span className={styles.cardinality}>
                  {idx.cardinality != null ? idx.cardinality.toLocaleString() : '—'}
                </span>
              </td>
              <td className={styles.td}>
                <span className={styles.columnPills}>
                  {idx.columns.map((col) => (
                    <span key={col} className={styles.columnPill}>
                      {col}
                    </span>
                  ))}
                </span>
              </td>
              <td className={styles.td}>
                <span className={styles.visible}>{idx.isVisible ? 'Yes' : 'No'}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
