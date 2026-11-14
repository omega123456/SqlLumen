import type { KeyboardEvent } from 'react'
import type { PaletteSearchResult } from '../../lib/command-palette-search'

export interface CommandPaletteFilterPillValue {
  kind: 'database' | 'object-type' | 'table'
  value: string
  label: string
}

export interface CommandPaletteInputProps {
  query: string
  pills: ReadonlyArray<CommandPaletteFilterPillValue>
  isSlashDropdownOpen: boolean
  onQueryChange: (value: string) => void
  onQueryKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
  onPillRemove: (pill: CommandPaletteFilterPillValue) => void
  inputRef: React.RefObject<HTMLInputElement | null>
  activeDescendantId?: string
}

export interface CommandPaletteResultsProps {
  results: ReadonlyArray<PaletteSearchResult>
  activeIndex: number
  state: 'no-connection' | 'loading' | 'empty' | 'recents' | 'results' | 'no-results'
  isColumnScope?: boolean
  onSelect: (result: PaletteSearchResult) => void
}
