import type { ReactNode } from 'react'
import styles from '../ColumnEditor.module.css'

interface CellFrameProps {
  modified: boolean
  testId: string
  children: ReactNode
}

export function CellFrame({ modified, testId, children }: CellFrameProps) {
  return (
    <div className={styles.cellFrame} data-testid={testId}>
      {modified && (
        <span className={styles.modifiedTriangle} aria-hidden data-testid={`${testId}-modified`} />
      )}
      {children}
    </div>
  )
}
