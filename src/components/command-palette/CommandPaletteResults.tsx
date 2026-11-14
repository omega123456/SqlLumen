import { MagnifyingGlass, Plug, SmileySad } from '@phosphor-icons/react'
import { useEffect, useRef, type ReactNode } from 'react'
import type { CommandPaletteResultsProps } from './palette-types'
import { CommandPaletteResultRow } from './CommandPaletteResultRow'
import styles from './CommandPaletteResults.module.css'

interface StateMessageProps {
  icon: ReactNode
  testId: string
  title: string
  body: string
}

function StateMessage({ icon, testId, title, body }: StateMessageProps) {
  return (
    <div className={styles.state} data-testid={testId}>
      <div className={styles.stateIcon} aria-hidden="true">
        {icon}
      </div>
      <div className={styles.stateTitle}>{title}</div>
      <div className={styles.stateBody}>{body}</div>
    </div>
  )
}

type ResultsState = CommandPaletteResultsProps['state']

const STATE_MESSAGES: Partial<Record<ResultsState, StateMessageProps>> = {
  'no-connection': {
    icon: <Plug size={18} weight="bold" />,
    testId: 'command-palette-empty-state',
    title: 'No active connection',
    body: 'Connect to a server first to search schema objects for that session.',
  },
  empty: {
    icon: <MagnifyingGlass size={18} weight="bold" />,
    testId: 'command-palette-empty-state',
    title: 'No recent objects yet',
    body: 'Search for a table, view, procedure, function, or trigger to start building your recent list.',
  },
  'no-results': {
    icon: <SmileySad size={18} weight="bold" />,
    testId: 'command-palette-no-results',
    title: 'No matching objects',
    body: 'Try a shorter query or adjust your filters to widen the search.',
  },
}

function resultsListLabels(isColumnScope: boolean, state: ResultsState) {
  if (isColumnScope) return { header: 'Columns', list: 'Columns' }
  if (state === 'recents') return { header: 'Recent', list: 'Recent objects' }
  return { header: 'Objects', list: 'Schema objects' }
}

const LOADING_PLACEHOLDER_ROW_COUNT = 5

function LoadingResults() {
  return (
    <div className={styles.resultsSurface} data-testid="command-palette-loading-state">
      <div className={styles.resultsHeader}>Loading schema objects</div>
      <ul className={styles.loadingList} aria-hidden="true">
        {Array.from({ length: LOADING_PLACEHOLDER_ROW_COUNT }, (_, index) => (
          <li key={index} className={styles.loadingRow} />
        ))}
      </ul>
    </div>
  )
}

export function CommandPaletteResults({
  results,
  activeIndex,
  state,
  isColumnScope = false,
  onSelect,
}: CommandPaletteResultsProps) {
  const listRef = useRef<HTMLUListElement | null>(null)

  useEffect(() => {
    const hasResultList = state === 'recents' || state === 'results'
    if (!hasResultList) {
      return
    }

    const activeOption = listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
    activeOption?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, results, state])

  const stateMessage = STATE_MESSAGES[state]
  if (stateMessage) {
    return <StateMessage {...stateMessage} />
  }

  if (state === 'loading') return <LoadingResults />

  const labels = resultsListLabels(isColumnScope, state)
  const showsRecentMarker = state === 'recents' && !isColumnScope

  return (
    <div className={styles.resultsSurface}>
      <div className={styles.resultsHeader} data-testid="command-palette-group-header">
        <span>{labels.header}</span>
        <span className={styles.resultsCount}>
          {results.length} result{results.length === 1 ? '' : 's'}
        </span>
      </div>
      <ul
        ref={listRef}
        id="command-palette-results"
        role="listbox"
        aria-label={labels.list}
        data-testid="command-palette-results"
        className={styles.resultsList}
      >
        {results.map((result, index) => (
          <CommandPaletteResultRow
            key={`${result.database}-${result.table ?? ''}-${result.objectType}-${result.name}`}
            id={`command-palette-result-${index}`}
            result={result}
            isActive={index === activeIndex}
            isRecent={showsRecentMarker}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </div>
  )
}
