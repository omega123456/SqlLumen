/**
 * HTML data table for query results — displays column headers,
 * row data, row selection, and NULL cell styling.
 */

import type { ColumnMeta } from '../../types/schema'
import styles from './ResultGrid.module.css'

type Row = (string | null)[]

interface ResultGridProps {
  columns: ColumnMeta[]
  rows: Row[]
  selectedRowIndex: number | null
  onRowSelect: (index: number) => void
}

export function ResultGrid({ columns, rows, selectedRowIndex, onRowSelect }: ResultGridProps) {
  return (
    <div className={styles.resultGrid} data-testid="result-grid">
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.rowNumHeader}>#</th>
            {columns.map((col, colIndex) => (
              <th key={colIndex}>
                {col.name}
                <span className={styles.sortIndicator}>⇅</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              data-selected={selectedRowIndex === i}
              data-row-index={i}
              onClick={() => onRowSelect(i)}
            >
              <td className={styles.rowNum}>{i + 1}</td>
              {row.map((cell, j) => (
                <td key={j}>
                  {cell === null ? <span className={styles.nullCell}>NULL</span> : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
