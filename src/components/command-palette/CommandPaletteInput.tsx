import { MagnifyingGlass } from '@phosphor-icons/react'
import { TextInput } from '../common/TextInput'
import type { CommandPaletteInputProps } from './palette-types'
import { CommandPaletteFilterPill } from './CommandPaletteFilterPill'

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
    <div
      className="flex h-10 w-full cursor-text items-center gap-2 rounded-control border border-x-light-stroke-control border-t-light-stroke-control border-b-light-stroke-text-field bg-light-fill-control px-2.5 not-focus-within:hover:bg-light-fill-control-hover focus-within:border-b-light-primary focus-within:bg-light-surface-container-high focus-within:shadow-light-field-focus dark:border-x-dark-stroke-control dark:border-t-dark-stroke-control dark:border-b-dark-stroke-text-field dark:bg-dark-fill-control dark:not-focus-within:hover:bg-dark-fill-control-hover dark:focus-within:border-b-dark-primary dark:focus-within:bg-dark-surface-container-high dark:focus-within:shadow-dark-field-focus"
      data-testid="command-palette-capsule"
    >
      <span
        className="inline-flex shrink-0 items-center justify-center text-light-outline dark:text-dark-outline"
        aria-hidden="true"
      >
        <MagnifyingGlass size={18} weight="bold" />
      </span>
      <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-1">
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
          className="h-6 min-w-20 flex-auto p-0 font-body outline-none text-palette-input text-light-on-surface placeholder:text-light-outline focus-visible:shadow-none dark:text-dark-on-surface dark:placeholder:text-dark-outline"
        />
      </div>
    </div>
  )
}
