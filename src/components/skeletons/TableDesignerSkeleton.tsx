import styles from './TableDesignerSkeleton.module.css'

const TAB_WIDTHS = ['70px', '65px', '100px', '120px', '85px']
const CELL_INNER_WIDTHS = [
  ['80%', '70%', '60%', '75%'],
  ['65%', '85%', '50%', '90%'],
  ['75%', '60%', '70%', '65%'],
  ['90%', '75%', '55%', '80%'],
]
const CELL_CLASSES = [styles.cellName, styles.cellType, styles.cellNull, styles.cellDefault]

export default function TableDesignerSkeleton() {
  return (
    <div className={styles.root} aria-hidden="true">
      <div className={styles.header}>
        <div className={`${styles.headerIcon} shimmerBlock`} />
        <div className={`${styles.headerName} shimmerBlock`} />
        <div className={styles.headerSpacer} />
        <div className={`${styles.headerButton} shimmerBlock`} />
        <div className={`${styles.headerButton} shimmerBlock`} />
      </div>
      <div className={styles.tabBar}>
        {TAB_WIDTHS.map((width, index) => (
          <div key={index} className={`${styles.tabPill} shimmerBlock`} style={{ width: width }} />
        ))}
      </div>
      <div className={styles.grid}>
        <div className={`${styles.gridHeaderRow} shimmerBlock`} />
        {CELL_INNER_WIDTHS.map((row, rowIndex) => (
          <div key={rowIndex} className={styles.gridRow}>
            {row.map((cellWidth, cellIndex) => (
              <div key={cellIndex} className={`${styles.gridCell} ${CELL_CLASSES[cellIndex]}`}>
                <div className={`${styles.cellBlock} shimmerBlock`} style={{ width: cellWidth }} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
