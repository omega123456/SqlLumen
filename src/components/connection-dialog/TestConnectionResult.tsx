import { CheckCircle, XCircle } from '@phosphor-icons/react'
import type { TestConnectionResult as TestConnectionResultType } from '../../types/connection'
import styles from './TestConnectionResult.module.css'

interface TestConnectionResultProps {
  result: TestConnectionResultType | null
}

export function TestConnectionResult({ result }: TestConnectionResultProps) {
  if (!result) return null

  if (result.success) {
    return (
      <div className={styles.resultSuccess} role="status">
        <div className={styles.resultHeader}>
          <CheckCircle size={20} weight="fill" className={styles.successIcon} />
          <span>Connection successful</span>
        </div>
        <div className={styles.resultGrid}>
          <span className={styles.label}>Server Version</span>
          <span className={styles.value}>{result.serverVersion}</span>
          <span className={styles.label}>Auth Method</span>
          <span className={styles.value}>{result.authMethod}</span>
          <span className={styles.label}>SSL</span>
          <span className={styles.value}>{result.sslStatus}</span>
          <span className={styles.label}>Connection Time</span>
          <span className={styles.value}>{result.connectionTimeMs} ms</span>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.resultError} role="alert">
      <div className={styles.resultHeader}>
        <XCircle size={20} weight="fill" className={styles.errorIcon} />
        <span>Connection failed</span>
      </div>
      <pre className={styles.errorMessage}>{result.errorMessage}</pre>
    </div>
  )
}
