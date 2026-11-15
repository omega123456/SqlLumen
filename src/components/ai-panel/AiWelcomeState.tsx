import { Sparkle } from '@phosphor-icons/react'
import { Button } from '../common/Button'

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
    <div
      className="flex flex-1 flex-col items-center justify-center p-6 select-none"
      data-testid="ai-welcome-state"
    >
      <div className="mb-3">
        <Sparkle
          size={48}
          weight="duotone"
          className="text-light-on-surface-variant opacity-30 dark:text-dark-on-surface-variant"
        />
      </div>
      <h3 className="mb-1 text-center font-headline text-size-body font-semibold wrap-break-word text-light-on-surface-variant dark:text-dark-on-surface-variant">
        Ask AI about your SQL
      </h3>
      <p className="mb-4 text-center font-body text-size-caption leading-body wrap-break-word text-light-on-surface-variant opacity-60 dark:text-dark-on-surface-variant">
        Get help writing, explaining,
        <br />
        or optimizing queries
      </p>
      <div className="grid w-full max-w-70 grid-cols-welcome-chips gap-2">
        {SUGGESTIONS.map((suggestion) => (
          <Button
            key={suggestion.label}
            variant="bare"
            className="flex h-control-sm cursor-pointer items-center justify-center gap-1.5 rounded-control bg-light-surface-container-high px-3 py-2 text-center font-body text-size-caption leading-chip font-regular whitespace-nowrap text-light-on-surface transition-bg-and-color duration-150 hover:bg-light-surface-container-highest focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-light-primary focus-visible:shadow-light-focus-ring dark:bg-dark-surface-container-high dark:text-dark-on-surface dark:hover:bg-dark-surface-container-highest dark:focus-visible:outline-dark-primary dark:focus-visible:shadow-dark-focus-ring"
            onClick={() => onSuggestionClick(suggestion.text)}
            data-testid="ai-suggestion-chip"
          >
            {suggestion.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
