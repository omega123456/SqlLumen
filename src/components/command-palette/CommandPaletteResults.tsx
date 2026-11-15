import { MagnifyingGlass, Plug, SmileySad } from '@phosphor-icons/react'
import { useEffect, useRef, type ReactNode } from 'react'
import type { CommandPaletteResultsProps } from './palette-types'
import { CommandPaletteResultRow } from './CommandPaletteResultRow'
import { joinClassNames, SCROLLBAR } from '../../lib/class-names'

interface StateMessageProps {
  icon: ReactNode
  testId: string
  title: string
  body: string
}

function StateMessage({ icon, testId, title, body }: StateMessageProps) {
  return (
    <div
      className="grid place-items-center gap-2.5 px-4.5 pt-9 pb-10 text-center text-light-on-surface-variant dark:text-dark-on-surface-variant"
      data-testid={testId}
    >
      <div
        className="inline-flex size-9 items-center justify-center rounded-pill bg-light-surface-container text-light-on-surface-variant dark:bg-dark-surface-container dark:text-dark-on-surface-variant"
        aria-hidden="true"
      >
        {icon}
      </div>
      <div className="text-size-body font-semibold text-light-on-surface dark:text-dark-on-surface">
        {title}
      </div>
      <div className="max-w-palette-state-message text-size-body leading-cozy">{body}</div>
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

interface ResultsHeaderProps {
  children: ReactNode
  testId?: string
}

function ResultsHeader({ children, testId }: ResultsHeaderProps) {
  return (
    <div
      className="flex shrink-0 justify-between px-4 pt-2.5 pb-1 text-size-caption leading-5 font-semibold text-light-on-surface-variant dark:text-dark-on-surface-variant"
      data-testid={testId}
    >
      {children}
    </div>
  )
}

function LoadingResults() {
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="command-palette-loading-state">
      <ResultsHeader>Loading schema objects</ResultsHeader>
      <ul className="list-none px-2.5 pb-2.5" aria-hidden="true">
        {Array.from({ length: LOADING_PLACEHOLDER_ROW_COUNT }, (_, index) => (
          <li
            key={index}
            className="mb-2 h-11 rounded-control bg-light-fill-neutral-selected dark:bg-dark-fill-neutral-selected"
          />
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
    <div className="flex min-h-0 flex-1 flex-col">
      <ResultsHeader testId="command-palette-group-header">
        <span>{labels.header}</span>
        <span className="font-regular">
          {results.length} result{results.length === 1 ? '' : 's'}
        </span>
      </ResultsHeader>
      <ul
        ref={listRef}
        id="command-palette-results"
        role="listbox"
        aria-label={labels.list}
        data-testid="command-palette-results"
        className={joinClassNames(['max-h-105 min-h-0 list-none overflow-y-auto p-1', SCROLLBAR])}
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
