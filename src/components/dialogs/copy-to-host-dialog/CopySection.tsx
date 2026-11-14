import type { ReactNode } from 'react'
import styles from '../CopyToHostDialog.module.css'

export function Section({
  title,
  testId,
  children,
}: {
  title: string
  testId?: string
  children: ReactNode
}) {
  return (
    <section className={styles.section} data-testid={testId}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  )
}
