import styles from './LogLevelBadge.module.css'

export interface LogLevelBadgeProps {
  level: string
}

const LEVEL_STYLES: Record<string, string> = {
  ERROR: styles.error,
  WARN: styles.warn,
  INFO: styles.info,
  DEBUG: styles.debug,
  TRACE: styles.trace,
}

export function LogLevelBadge({ level }: LogLevelBadgeProps) {
  const normalizedLevel = level.toUpperCase()
  const toneClassName = LEVEL_STYLES[normalizedLevel] ?? styles.info

  return <span className={`${styles.badge} ${toneClassName}`}>{normalizedLevel}</span>
}
