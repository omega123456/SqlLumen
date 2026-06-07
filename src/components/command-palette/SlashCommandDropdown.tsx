import { Stack } from '@phosphor-icons/react'
import { useEffect, useRef } from 'react'
import { ObjectTypeIcon } from '../shared/ObjectTypeIcon'
import type { PaletteTypeFilter } from '../../types/schema'
import type { CommandPaletteFilterPillValue } from './CommandPalette'
import { buildSlashOptions } from './slash-options'
import styles from './SlashCommandDropdown.module.css'

export interface SlashCommandDropdownProps {
  slashQuery: string
  databases: ReadonlyArray<string>
  activeIndex: number
  onSelect: (pill: CommandPaletteFilterPillValue) => void
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
      {keywordOptions.length > 0 ? (
        <section className={styles.section} aria-label="Keywords">
          <div className={styles.sectionLabel}>Keywords</div>
          {keywordOptions.map((option, index) => {
            const isActive = index === activeIndex

            return (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={isActive}
                className={styles.option}
                data-active={isActive ? 'true' : 'false'}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelect(option.pill)}
              >
                <span className={styles.optionIcon}>
                  <ObjectTypeIcon objectType={option.pill.value as PaletteTypeFilter} />
                </span>
                <span className={styles.optionCopy}>
                  <span className={styles.optionLabel}>{option.pill.label}</span>
                  <span className={styles.optionMeta}>{option.meta}</span>
                </span>
              </button>
            )
          })}
        </section>
      ) : null}
      {databaseOptions.length > 0 ? (
        <section className={styles.section} aria-label="Databases">
          <div className={styles.sectionLabel}>Databases</div>
          {databaseOptions.map((option, index) => {
            const optionIndex = keywordOptions.length + index
            const isActive = optionIndex === activeIndex

            return (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={isActive}
                className={styles.option}
                data-active={isActive ? 'true' : 'false'}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelect(option.pill)}
              >
                <span className={styles.optionIcon} aria-hidden="true">
                  <Stack size={16} weight="fill" />
                </span>
                <span className={styles.optionCopy}>
                  <span className={styles.optionLabel}>{option.pill.label}</span>
                  <span className={styles.optionMeta}>{option.meta}</span>
                </span>
              </button>
            )
          })}
        </section>
      ) : null}
    </div>
  )
}
