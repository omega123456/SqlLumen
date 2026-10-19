import { ClockCounterClockwise } from '@phosphor-icons/react'
import { Fragment, useMemo, type MouseEvent } from 'react'
import type { PaletteSearchResult } from '../../lib/command-palette-search'
import type { PaletteResultType } from '../../types/schema'
import { ObjectTypeIcon } from '../shared/ObjectTypeIcon'
import { SearchColumnsHint } from './CommandPaletteKeyHints'
import styles from './CommandPaletteResults.module.css'

export interface CommandPaletteResultRowProps {
  result: PaletteSearchResult
  id: string
  isActive: boolean
  isRecent: boolean
  onSelect: (result: PaletteSearchResult) => void
}

const KIND_LABELS: Record<PaletteResultType, string> = {
  table: 'Table',
  view: 'View',
  procedure: 'Procedure',
  function: 'Function',
  trigger: 'Trigger',
  column: 'Column',
}

function buildHighlightFlags(
  name: string,
  matchIndices: ReadonlyArray<readonly [number, number]>
): boolean[] {
  const flags = Array.from({ length: name.length }, () => false)

  for (const [start, end] of matchIndices) {
    for (let index = start; index <= end && index < name.length; index += 1) {
      flags[index] = true
    }
  }

  return flags
}

function renderHighlightedName(result: PaletteSearchResult) {
  const { matchIndices, name } = result

  if (matchIndices.length === 0) {
    return name
  }

  const highlightFlags = buildHighlightFlags(name, matchIndices)
  const segments: Array<{ text: string; highlighted: boolean }> = []
  let currentText = ''
  let currentHighlighted = highlightFlags[0] ?? false

  for (const [index, character] of Array.from(name).entries()) {
    const highlighted = highlightFlags[index] ?? false
    if (index === 0) {
      currentText = character
      currentHighlighted = highlighted
      continue
    }

    if (highlighted === currentHighlighted) {
      currentText += character
      continue
    }

    segments.push({ text: currentText, highlighted: currentHighlighted })
    currentText = character
    currentHighlighted = highlighted
  }

  if (currentText) {
    segments.push({ text: currentText, highlighted: currentHighlighted })
  }

  return segments.map((segment, index) => {
    if (!segment.highlighted) {
      return <Fragment key={`${segment.text}-${index}`}>{segment.text}</Fragment>
    }

    return (
      <strong key={`${segment.text}-${index}`} className={styles.match}>
        {segment.text}
      </strong>
    )
  })
}

export function CommandPaletteResultRow({
  result,
  id,
  isActive,
  isRecent,
  onSelect,
}: CommandPaletteResultRowProps) {
  const highlightedName = useMemo(() => renderHighlightedName(result), [result])
  // Columns show their data type; objects show "<Kind> · <database>" (prototype `.pi-row .db`).
  const metaLabel = result.metaLabel ?? `${KIND_LABELS[result.objectType]} · ${result.database}`

  const handleMouseDown = (event: MouseEvent<HTMLLIElement>) => {
    event.preventDefault()
  }

  return (
    <li
      id={id}
      role="option"
      aria-selected={isActive}
      data-testid={id}
      data-active={isActive ? 'true' : 'false'}
      className={styles.row}
      onMouseDown={handleMouseDown}
      onClick={() => onSelect(result)}
    >
      <div className={styles.rowIcon}>
        <ObjectTypeIcon objectType={result.objectType} size={16} weight="regular" />
      </div>
      <div className={styles.rowText}>
        <span className={styles.rowName}>{highlightedName}</span>
        <span className={styles.rowMeta}>{metaLabel}</span>
      </div>
      {result.objectType === 'table' || isRecent ? (
        <span className={styles.rowTrailing}>
          {result.objectType === 'table' ? <SearchColumnsHint /> : null}
          {isRecent ? (
            <span className={styles.recentBadge} aria-label="Recent object">
              <ClockCounterClockwise size={14} weight="bold" />
            </span>
          ) : null}
        </span>
      ) : null}
    </li>
  )
}
