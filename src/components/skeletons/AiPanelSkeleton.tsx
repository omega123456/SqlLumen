import styles from './AiPanelSkeleton.module.css'

export default function AiPanelSkeleton() {
  return (
    <div className={styles.root} aria-hidden="true">
      <div className={styles.header}>
        <div className={`${styles.headerTitle} shimmerBlock`} />
        <div className={styles.headerSpacer} />
        <div className={`${styles.headerIcon} shimmerBlock`} />
        <div className={`${styles.headerIcon} shimmerBlock`} />
      </div>
      <div className={styles.chatArea}>
        <div className={`${styles.assistantMsg} ${styles.assistantMsg1} shimmerBlock`} />
        <div className={`${styles.assistantMsg} ${styles.assistantMsg2} shimmerBlock`} />
        <div className={`${styles.userMsg} shimmerBlock`} />
        <div className={`${styles.assistantMsg} ${styles.assistantMsg3} shimmerBlock`} />
      </div>
      <div className={styles.inputArea}>
        <div className={`${styles.inputRect} shimmerBlock`} />
        <div className={`${styles.sendButton} shimmerBlock`} />
      </div>
    </div>
  )
}
