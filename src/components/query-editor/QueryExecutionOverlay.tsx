/**
 * Blocking overlay rendered on top of the Monaco editor and result panel
 * while a query is running. Prevents user interaction with the content area.
 *
 * The parent conditionally renders this component when status === 'running'.
 * The visual scrim fades in after a 300ms delay via CSS animation.
 */

import styles from './QueryExecutionOverlay.module.css'

export function QueryExecutionOverlay() {
  return <div className={styles.overlay} data-testid="query-execution-overlay" />
}
