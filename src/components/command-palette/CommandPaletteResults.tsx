import { MagnifyingGlass, Plug, SmileySad } from '@phosphor-icons/react'
import { useEffect, useRef, type ReactNode } from 'react'
import type { CommandPaletteResultsProps } from './CommandPalette'
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

export function CommandPaletteResults({
  results,
  activeIndex,
  state,
  isColumnScope = false,
  onSelect,
}: CommandPaletteResultsProps) {
  const listRef = useRef<HTMLUListElement | null>(null)

  useEffect(() => {
    if (state !== 'recents' && state !== 'results') {
      return
    }

    const activeOption = listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
    activeOption?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, results, state])

  if (state === 'no-connection') {
    return (
      <StateMessage
        icon={<Plug size={18} weight="bold" />}
        testId="command-palette-empty-state"
        title="No active connection"
        body="Connect to a server first to search schema objects for that session."
      />
    )
  }

  if (state === 'loading') {
    return (
      <div className={styles.resultsSurface} data-testid="command-palette-loading-state">
        <div className={styles.resultsHeader}>Loading schema objects</div>
        <ul className={styles.loadingList} aria-hidden="true">
          {Array.from({ length: 5 }, (_, index) => (
            <li key={index} className={styles.loadingRow} />
          ))}
        </ul>
      </div>
    )
  }

  if (state === 'empty') {
    return (
      <StateMessage
        icon={<MagnifyingGlass size={18} weight="bold" />}
        testId="command-palette-empty-state"
        title="No recent objects yet"
        body="Search for a table, view, procedure, function, or trigger to start building your recent list."
      />
    )
  }

  if (state === 'no-results') {
    return (
      <StateMessage
        icon={<SmileySad size={18} weight="bold" />}
        testId="command-palette-no-results"
        title="No matching objects"
        body="Try a shorter query or adjust your filters to widen the search."
      />
    )
  }

  return (
    <div className={styles.resultsSurface}>
      <div className={styles.resultsHeader}>
        {isColumnScope
          ? 'Columns'
          : state === 'recents'
            ? 'Recent'
            : `${results.length} result${results.length === 1 ? '' : 's'}`}
      </div>
      <ul
        ref={listRef}
        id="command-palette-results"
        role="listbox"
        aria-label={
          isColumnScope ? 'Columns' : state === 'recents' ? 'Recent objects' : 'Schema objects'
        }
        data-testid="command-palette-results"
        className={styles.resultsList}
      >
        {results.map((result, index) => (
          <CommandPaletteResultRow
            key={`${result.database}-${result.table ?? ''}-${result.objectType}-${result.name}`}
            id={`command-palette-result-${index}`}
            result={result}
            isActive={index === activeIndex}
            isRecent={state === 'recents' && !isColumnScope}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </div>
  )
}
