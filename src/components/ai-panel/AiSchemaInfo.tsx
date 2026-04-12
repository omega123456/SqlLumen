import { WarningCircle } from '@phosphor-icons/react'
import { useAiStore } from '../../stores/ai-store'
import styles from './AiSchemaInfo.module.css'

export interface AiSchemaInfoProps {
  tabId: string
}

export function AiSchemaInfo({ tabId }: AiSchemaInfoProps) {
  const schemaTokenCount = useAiStore((s) => s.tabs[tabId]?.schemaTokenCount ?? 0)
  const schemaWarning = useAiStore((s) => s.tabs[tabId]?.schemaWarning ?? false)

  if (schemaTokenCount === 0) {
    return null
  }

  const formattedCount =
    schemaTokenCount >= 1000
      ? `~${(schemaTokenCount / 1000).toFixed(1)}k tokens`
      : `~${schemaTokenCount} tokens`

  return (
    <div
      className={`${styles.container} ${schemaWarning ? styles.warning : ''}`}
      title={
        schemaWarning
          ? `Schema context is large (~${schemaTokenCount} tokens) — may reduce response quality`
          : `Schema context: ~${schemaTokenCount} estimated tokens`
      }
      data-testid="ai-schema-info"
    >
      {schemaWarning && (
        <WarningCircle size={14} weight="fill" className={styles.warningIcon} aria-hidden="true" />
      )}
      <span className={styles.text}>{formattedCount}</span>
    </div>
  )
}
