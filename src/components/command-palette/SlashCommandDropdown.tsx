import { Stack } from '@phosphor-icons/react'
import { useEffect, useRef } from 'react'
import { ObjectTypeIcon } from '../shared/ObjectTypeIcon'
import type { PaletteTypeFilter } from '../../types/schema'
import type { CommandPaletteFilterPillValue } from './palette-types'
import { buildSlashOptions, type SlashOption } from './slash-options'
import { Button } from '../common/Button'
import styles from './SlashCommandDropdown.module.css'

export interface SlashCommandDropdownProps {
  slashQuery: string
  databases: ReadonlyArray<string>
  activeIndex: number
  onSelect: (pill: CommandPaletteFilterPillValue) => void
}

function SlashOptionIcon({ option }: { option: SlashOption }) {
  if (option.kind === 'keyword') {
    return (
      <span className={styles.optionIcon}>
        <ObjectTypeIcon objectType={option.pill.value as PaletteTypeFilter} />
      </span>
    )
  }
  return (
    <span className={styles.optionIcon} aria-hidden="true">
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
    <section className={styles.section} aria-label={label}>
      <div className={styles.sectionLabel}>{label}</div>
      {options.map((option, index) => {
        const isActive = firstOptionIndex + index === activeIndex

        return (
          <Button
            variant="bare"
            key={option.id}
            role="option"
            aria-selected={isActive}
            className={styles.option}
            data-active={isActive ? 'true' : 'false'}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(option.pill)}
          >
            <SlashOptionIcon option={option} />
            <span className={styles.optionCopy}>
              <span className={styles.optionLabel}>{option.pill.label}</span>
              <span className={styles.optionMeta}>{option.meta}</span>
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
      <div className={styles.emptyState} data-testid="command-palette-slash-empty">
        No slash commands match
      </div>
    )
  }

  return (
    <div
      ref={listRef}
      className={styles.dropdown}
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
