import { Sparkle } from '@phosphor-icons/react'
import { Button } from '../common/Button'
import styles from './AiWelcomeState.module.css'

export interface AiWelcomeStateProps {
  onSuggestionClick: (text: string) => void
}

const SUGGESTIONS = [
  { label: 'Explain query', text: 'Explain this query step by step' },
  { label: 'Optimize for speed', text: 'Optimize this query for better performance' },
  { label: 'Generate a JOIN', text: 'Write a JOIN query that combines these tables' },
  { label: 'Find potential issues', text: 'Find potential issues or bugs in this query' },
]

export function AiWelcomeState({ onSuggestionClick }: AiWelcomeStateProps) {
  return (
    <div className={styles.container} data-testid="ai-welcome-state">
      <div className={styles.iconWrapper}>
        <Sparkle size={48} weight="duotone" className={styles.icon} />
      </div>
      <h3 className={styles.headline}>Ask AI about your SQL</h3>
      <p className={styles.subtext}>
        Get help writing, explaining,
        <br />
        or optimizing queries
      </p>
      <div className={styles.chipGrid}>
        {SUGGESTIONS.map((s) => (
          <Button
            key={s.label}
            variant="ghost"
            className={styles.chip}
            onClick={() => onSuggestionClick(s.text)}
            data-testid="ai-suggestion-chip"
          >
            {s.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
