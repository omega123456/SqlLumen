import { FolderPlus, MagnifyingGlass, Plus, X } from '@phosphor-icons/react'
import { TextInput } from '../../common/TextInput'
import { IconButton } from '../../common/IconButton'

const TOOLBAR_ICON_SIZE = 16

interface SavedConnectionsToolbarProps {
  filterText: string
  onFilterTextChange: (value: string) => void
  onNewConnection: () => void
  onCreateGroup: () => void
}

export function SavedConnectionsToolbar({
  filterText,
  onFilterTextChange,
  onNewConnection,
  onCreateGroup,
}: SavedConnectionsToolbarProps) {
  return (
    <div className="flex shrink-0 gap-1">
      <div className="relative flex min-w-0 flex-1 items-center">
        <span className="pointer-events-none absolute left-2.5 flex items-center text-light-outline dark:text-dark-outline">
          <MagnifyingGlass size={TOOLBAR_ICON_SIZE} weight="regular" />
        </span>
        <TextInput
          type="text"
          variant="listSearch"
          placeholder="Filter connections"
          value={filterText}
          onChange={(event) => onFilterTextChange(event.target.value)}
          data-testid="connection-filter-input"
          aria-label="Filter connections"
        />
        {filterText && (
          <IconButton
            size="sm"
            className="absolute right-1"
            onClick={() => onFilterTextChange('')}
            tabIndex={-1}
            aria-label="Clear connection filter"
            data-testid="connection-filter-clear"
          >
            <X size={TOOLBAR_ICON_SIZE} weight="regular" />
          </IconButton>
        )}
      </div>
      <IconButton
        size="lg"
        onClick={onNewConnection}
        title="New connection"
        aria-label="New connection"
      >
        <Plus size={TOOLBAR_ICON_SIZE} weight="regular" />
      </IconButton>
      <IconButton size="lg" onClick={onCreateGroup} title="New group" aria-label="New group">
        <FolderPlus size={TOOLBAR_ICON_SIZE} weight="regular" />
      </IconButton>
    </div>
  )
}
