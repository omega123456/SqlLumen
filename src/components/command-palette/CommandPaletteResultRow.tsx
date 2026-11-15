import { ClockCounterClockwise } from '@phosphor-icons/react'
import { Fragment, useMemo, type MouseEvent } from 'react'
import type { PaletteSearchResult } from '../../lib/command-palette-search'
import type { PaletteResultType } from '../../types/schema'
import { ObjectTypeIcon } from '../shared/ObjectTypeIcon'
import { SearchColumnsHint } from './CommandPaletteKeyHints'
import { joinClassNames } from '../../lib/class-names'

export interface CommandPaletteResultRowProps {
  result: PaletteSearchResult
  id: string
  isActive: boolean
  isRecent: boolean
  onSelect: (result: PaletteSearchResult) => void
}

type RowState = 'idle' | 'active'

const ROW_FRAME_CLASSES =
  'relative grid h-10 cursor-default grid-cols-palette-row items-center gap-3 rounded-control px-3 text-size-body text-light-on-surface dark:text-dark-on-surface'

const ROW_STATE_CLASSES: Record<RowState, string> = {
  idle: 'hover:bg-light-fill-subtle-hover dark:hover:bg-dark-fill-subtle-hover',
  active:
    'bg-light-fill-neutral-selected before:absolute before:top-1/2 before:left-0 before:-mt-2 before:h-4 before:w-0.75 before:rounded-track before:bg-light-primary dark:bg-dark-fill-neutral-selected dark:before:bg-dark-primary',
}

function rowState(isActive: boolean): RowState {
  if (isActive) return 'active'
  return 'idle'
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

  const lastNameIndex = name.length - 1
  for (const [start, end] of matchIndices) {
    const lastHighlightedIndex = Math.min(end, lastNameIndex)
    for (let index = start; index <= lastHighlightedIndex; index += 1) {
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
      <strong
        key={`${segment.text}-${index}`}
        className="font-semibold text-light-primary dark:text-dark-primary"
      >
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
  const metaLabel = result.metaLabel ?? `${KIND_LABELS[result.objectType]} · ${result.database}`

  const hasTrailingContent = result.objectType === 'table' || isRecent

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
      className={joinClassNames([ROW_FRAME_CLASSES, ROW_STATE_CLASSES[rowState(isActive)]])}
      onMouseDown={handleMouseDown}
      onClick={() => onSelect(result)}
    >
      <div className="flex items-center justify-center">
        <ObjectTypeIcon objectType={result.objectType} size={16} weight="regular" />
      </div>
      <div className="flex min-w-0 items-baseline gap-3 overflow-hidden">
        <span className="min-w-0 truncate">{highlightedName}</span>
        <span className="flex-none text-size-caption leading-5 whitespace-nowrap text-light-on-surface-variant dark:text-dark-on-surface-variant">
          {metaLabel}
        </span>
      </div>
      {hasTrailingContent ? (
        <span className="inline-flex items-center gap-2">
          {result.objectType === 'table' ? <SearchColumnsHint /> : null}
          {isRecent ? (
            <span
              className="inline-flex items-center justify-center text-light-on-surface-variant dark:text-dark-on-surface-variant"
              aria-label="Recent object"
            >
              <ClockCounterClockwise size={14} weight="bold" />
            </span>
          ) : null}
        </span>
      ) : null}
    </li>
  )
}
