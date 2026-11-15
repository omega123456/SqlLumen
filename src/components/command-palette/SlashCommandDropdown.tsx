import { Stack } from '@phosphor-icons/react'
import { useEffect, useRef } from 'react'
import { ObjectTypeIcon } from '../shared/ObjectTypeIcon'
import type { PaletteTypeFilter } from '../../types/schema'
import type { CommandPaletteFilterPillValue } from './palette-types'
import { buildSlashOptions, type SlashOption } from './slash-options'
import { Button } from '../common/Button'
import { joinClassNames, SCROLLBAR } from '../../lib/class-names'
import { FOCUS_RING } from '../../lib/focus-ring'
import { LISTBOX_OPTION_STATE_CLASSES, listboxOptionState } from '../../lib/class-names-menu'

export interface SlashCommandDropdownProps {
  slashQuery: string
  databases: ReadonlyArray<string>
  activeIndex: number
  onSelect: (pill: CommandPaletteFilterPillValue) => void
}

function SlashOptionIcon({ option }: { option: SlashOption }) {
  if (option.kind === 'keyword') {
    return (
      <span className="inline-flex items-center justify-center text-light-on-surface-variant dark:text-dark-on-surface-variant">
        <ObjectTypeIcon objectType={option.pill.value as PaletteTypeFilter} />
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center justify-center text-light-on-surface-variant dark:text-dark-on-surface-variant"
      aria-hidden="true"
    >
      <Stack size={16} weight="fill" />
    </span>
  )
}

interface SlashOptionSectionProps {
  label: string
  options: SlashOption[]
  firstOptionIndex: number
  activeIndex: number
  onSelect: (pill: CommandPaletteFilterPillValue) => void
}

function SlashOptionSection({
  label,
  options,
  firstOptionIndex,
  activeIndex,
  onSelect,
}: SlashOptionSectionProps) {
  if (options.length === 0) return null
  return (
    <section
      className="not-first:mt-2 not-first:border-t not-first:border-light-stroke-divider not-first:pt-2 dark:not-first:border-dark-stroke-divider"
      aria-label={label}
    >
      <div className="px-2.5 pt-1 pb-2 text-size-caption font-semibold text-light-on-surface-variant dark:text-dark-on-surface-variant">
        {label}
      </div>
      {options.map((option, index) => {
        const isActive = firstOptionIndex + index === activeIndex

        return (
          <Button
            variant="bare"
            key={option.id}
            role="option"
            aria-selected={isActive}
            className={joinClassNames([
              'flex w-full cursor-pointer items-center gap-2.5 rounded-card p-2.5 text-left text-light-on-surface dark:text-dark-on-surface',
              LISTBOX_OPTION_STATE_CLASSES[listboxOptionState(isActive)],
              FOCUS_RING,
            ])}
            data-active={isActive ? 'true' : 'false'}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(option.pill)}
          >
            <SlashOptionIcon option={option} />
            <span className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
              <span className="font-semibold text-light-on-surface dark:text-dark-on-surface">
                {option.pill.label}
              </span>
              <span className="text-size-caption text-light-outline dark:text-dark-outline">
                {option.meta}
              </span>
            </span>
          </Button>
        )
      })}
    </section>
  )
}

export function SlashCommandDropdown({
  slashQuery,
  databases,
  activeIndex,
  onSelect,
}: SlashCommandDropdownProps) {
  const options = buildSlashOptions(slashQuery, databases)
  const keywordOptions = options.filter((option) => option.kind === 'keyword')
  const databaseOptions = options.filter((option) => option.kind === 'database')
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const activeOption = listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
    activeOption?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, options.length])

  if (options.length === 0) {
    return (
      <div
        className="p-4.5 text-light-on-surface-variant dark:text-dark-on-surface-variant"
        data-testid="command-palette-slash-empty"
      >
        No slash commands match
      </div>
    )
  }

  return (
    <div
      ref={listRef}
      className={joinClassNames([
        'max-h-70 overflow-auto border-t border-light-stroke-divider bg-light-surface-container-high p-2 dark:border-dark-stroke-divider dark:bg-dark-surface-container-high',
        SCROLLBAR,
      ])}
      role="listbox"
      aria-label="Slash commands"
      data-testid="command-palette-slash-dropdown"
    >
      <SlashOptionSection
        label="Keywords"
        options={keywordOptions}
        firstOptionIndex={0}
        activeIndex={activeIndex}
        onSelect={onSelect}
      />
      <SlashOptionSection
        label="Databases"
        options={databaseOptions}
        firstOptionIndex={keywordOptions.length}
        activeIndex={activeIndex}
        onSelect={onSelect}
      />
    </div>
  )
}
