import styles from './TableDataPlaceholder.module.css'

export interface TableDataPlaceholderProps {
  databaseName: string
  tableName: string
}

export function TableDataPlaceholder({ databaseName, tableName }: TableDataPlaceholderProps) {
  return (
    <div className={styles.container} data-testid="table-data-placeholder">
      <div className={styles.card}>
        <span className={styles.icon} aria-hidden="true">
          &#x2637;
        </span>
        <h3 className={styles.headline}>
          {databaseName}.{tableName}
        </h3>
        <p className={styles.subtext}>Table data viewing will be available in Phase 6</p>
      </div>
    </div>
  )
}
