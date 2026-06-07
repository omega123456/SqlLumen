import { MagnifyingGlass } from '@phosphor-icons/react'
import { TextInput } from '../common/TextInput'
import type { CommandPaletteInputProps } from './CommandPalette'
import { CommandPaletteFilterPill } from './CommandPaletteFilterPill'
import styles from './CommandPaletteInput.module.css'

export function CommandPaletteInput({
  query,
  pills,
  isSlashDropdownOpen,
  onQueryChange,
  onQueryKeyDown,
  onPillRemove,
  inputRef,
  activeDescendantId,
}: CommandPaletteInputProps) {
  return (
    <div className={styles.capsule} data-testid="command-palette-capsule">
      <span className={styles.searchIcon} aria-hidden="true">
        <MagnifyingGlass size={18} weight="bold" />
      </span>
      <div className={styles.content}>
        {pills.map((pill) => (
          <CommandPaletteFilterPill
            key={`${pill.kind}-${pill.value}`}
            pill={pill}
            onRemove={() => onPillRemove(pill)}
          />
        ))}
        <TextInput
          ref={inputRef}
          variant="bare"
          value={query}
          onChange={(event) => {
            onQueryChange(event.target.value)
          }}
          onKeyDown={onQueryKeyDown}
          placeholder="Search schema objects"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isSlashDropdownOpen}
          aria-controls="command-palette-results"
          aria-activedescendant={activeDescendantId}
          data-testid="command-palette-input"
          className={styles.input}
        />
      </div>
    </div>
  )
}
