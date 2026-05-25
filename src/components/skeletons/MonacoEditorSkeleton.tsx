import styles from './MonacoEditorSkeleton.module.css'

const LINE_WIDTHS = ['75%', '55%', '90%', '40%', '70%', '85%', '50%', '65%']

export default function MonacoEditorSkeleton() {
  return (
    <div className={styles.root} aria-hidden="true">
      <div className={`${styles.gutter} shimmerBlock`} />
      <div className={styles.codeArea}>
        {LINE_WIDTHS.map((width, i) => (
          <div key={i} className={`${styles.codeLine} shimmerBlock`} style={{ width }} />
        ))}
      </div>
    </div>
  )
}
