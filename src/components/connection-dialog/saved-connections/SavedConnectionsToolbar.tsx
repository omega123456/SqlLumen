import { FolderPlus, MagnifyingGlass, Plus, X } from '@phosphor-icons/react'
import { TextInput } from '../../common/TextInput'
import { IconButton } from '../../common/IconButton'
import styles from '../SavedConnectionsList.module.css'

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
    <div className={styles.toolbar}>
      <div className={styles.searchWrapper}>
        <span className={styles.searchIcon}>
          <MagnifyingGlass size={TOOLBAR_ICON_SIZE} weight="regular" />
        </span>
        <TextInput
          type="text"
          className={styles.searchInput}
          placeholder="Filter connections"
          value={filterText}
          onChange={(event) => onFilterTextChange(event.target.value)}
          data-testid="connection-filter-input"
          aria-label="Filter connections"
        />
        {filterText && (
          <IconButton
            size="sm"
            className={styles.clearButton}
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
