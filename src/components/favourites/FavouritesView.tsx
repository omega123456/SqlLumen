import { useCallback, useEffect, useMemo, useState } from 'react'
import { MagnifyingGlass, Plus } from '@phosphor-icons/react'
import { useFavoritesStore } from '../../stores/favorites-store'
import { insertSqlIntoEditor } from '../../lib/query-tab-utils'
import { TextInput } from '../common/TextInput'
import { Button } from '../common/Button'
import { ConfirmDialog } from '../dialogs/ConfirmDialog'
import { FavouritesSnippetCard } from './FavouritesSnippetCard'
import { FavouritesDetailPanel } from './FavouritesDetailPanel'
import type { FavoriteEntry } from '../../types/schema'
import styles from './FavouritesView.module.css'

export interface FavouritesViewProps {
  connectionId: string
}

function matchesSearch(entry: FavoriteEntry, lowerCaseQuery: string): boolean {
  const isNameMatch = entry.name.toLowerCase().includes(lowerCaseQuery)
  const isDescriptionMatch = Boolean(entry.description?.toLowerCase().includes(lowerCaseQuery))
  return isNameMatch || isDescriptionMatch
}

function filterFavourites(entries: FavoriteEntry[], searchQuery: string): FavoriteEntry[] {
  if (!searchQuery.trim()) return entries
  const lowerCaseQuery = searchQuery.toLowerCase()
  return entries.filter((entry) => matchesSearch(entry, lowerCaseQuery))
}

function useFavouriteSelection() {
  const deleteFavorite = useFavoritesStore((state) => state.deleteFavorite)
  const [selectedFavouriteId, setSelectedFavouriteId] = useState<number | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null)

  const confirmDelete = useCallback(() => {
    if (pendingDeleteId == null) return
    void deleteFavorite(pendingDeleteId)
    if (selectedFavouriteId === pendingDeleteId) {
      setSelectedFavouriteId(null)
    }
    setPendingDeleteId(null)
  }, [deleteFavorite, selectedFavouriteId, pendingDeleteId])

  const cancelDelete = useCallback(() => {
    setPendingDeleteId(null)
  }, [])

  const toggleSelected = useCallback((id: number) => {
    setSelectedFavouriteId((previous) => (previous === id ? null : id))
  }, [])

  return {
    selectedFavouriteId: selectedFavouriteId,
    pendingDeleteId: pendingDeleteId,
    requestDelete: setPendingDeleteId,
    confirmDelete: confirmDelete,
    cancelDelete: cancelDelete,
    toggleSelected: toggleSelected,
  }
}

interface FavouriteListItemProps {
  connectionId: string
  favourite: FavoriteEntry
  isSelected: boolean
  onSelect: (id: number) => void
  onDelete: (id: number) => void
}

function FavouriteListItem({
  connectionId,
  favourite,
  isSelected,
  onSelect,
  onDelete,
}: FavouriteListItemProps) {
  const openDialog = useFavoritesStore((state) => state.openDialog)
  const insertFavourite = () =>
    insertSqlIntoEditor(connectionId, favourite.sqlText, favourite.name || 'Favorite query')

  return (
    <div>
      <FavouritesSnippetCard
        favourite={favourite}
        isSelected={isSelected}
        onSelect={() => onSelect(favourite.id)}
        onEdit={() => openDialog(favourite)}
        onInsert={insertFavourite}
      />
      {isSelected && (
        <FavouritesDetailPanel
          favourite={favourite}
          onInsert={insertFavourite}
          onDelete={() => onDelete(favourite.id)}
        />
      )}
    </div>
  )
}

interface FavouritesListContentProps {
  connectionId: string
  searchQuery: string
  selectedFavouriteId: number | null
  onSelect: (id: number) => void
  onDelete: (id: number) => void
}

function FavouritesListContent({
  connectionId,
  searchQuery,
  selectedFavouriteId,
  onSelect,
  onDelete,
}: FavouritesListContentProps) {
  const entries = useFavoritesStore((state) => state.entries)
  const isLoading = useFavoritesStore((state) => state.isLoading)
  const error = useFavoritesStore((state) => state.error)
  const loadFavorites = useFavoritesStore((state) => state.loadFavorites)
  const filteredFavourites = useMemo(
    () => filterFavourites(entries, searchQuery),
    [entries, searchQuery]
  )

  if (error) {
    return (
      <div className={styles.errorState} data-testid="favourites-error">
        <span className={styles.errorMessage}>{error}</span>
        <Button
          variant="subtle"
          size="sm"
          onClick={() => void loadFavorites(connectionId)}
          data-testid="favourites-retry"
        >
          Retry
        </Button>
      </div>
    )
  }
  const isLoadingFirstEntries = isLoading && entries.length === 0
  if (isLoadingFirstEntries) {
    return <div className={styles.emptyState}>Loading...</div>
  }
  if (entries.length === 0) {
    return (
      <div className={styles.emptyState} data-testid="favourites-empty">
        No favourites yet
      </div>
    )
  }
  if (filteredFavourites.length === 0) {
    return (
      <div className={styles.emptyState} data-testid="favourites-no-results">
        No matching snippets
      </div>
    )
  }
  return filteredFavourites.map((favourite) => (
    <FavouriteListItem
      key={favourite.id}
      connectionId={connectionId}
      favourite={favourite}
      isSelected={selectedFavouriteId === favourite.id}
      onSelect={onSelect}
      onDelete={onDelete}
    />
  ))
}

interface FavouritesSearchProps {
  searchQuery: string
  onSearchQueryChange: (searchQuery: string) => void
}

function FavouritesSearch({ searchQuery, onSearchQueryChange }: FavouritesSearchProps) {
  return (
    <div className={styles.searchWrapper}>
      <span className={styles.searchIcon}>
        <MagnifyingGlass size={14} weight="regular" />
      </span>
      <TextInput
        variant="bare"
        type="text"
        className={styles.searchInput}
        placeholder="Search snippets..."
        value={searchQuery}
        onChange={(event) => onSearchQueryChange(event.target.value)}
        data-testid="favourites-search"
        aria-label="Search snippets"
      />
    </div>
  )
}

export function FavouritesView({ connectionId }: FavouritesViewProps) {
  const openDialog = useFavoritesStore((state) => state.openDialog)
  const loadFavorites = useFavoritesStore((state) => state.loadFavorites)
  const [searchQuery, setSearchQuery] = useState('')
  const selection = useFavouriteSelection()

  useEffect(() => {
    void loadFavorites(connectionId)
  }, [connectionId, loadFavorites])

  return (
    <div className={styles.container} data-testid="favourites-view">
      <div className={styles.headerRow}>
        <h2 className={styles.title}>Favourites</h2>
        <Button
          variant="subtle"
          size="sm"
          onClick={() => openDialog(null)}
          data-testid="favourites-new-snippet"
        >
          <Plus size={14} weight="bold" />
          &nbsp;New Snippet
        </Button>
      </div>

      <FavouritesSearch searchQuery={searchQuery} onSearchQueryChange={setSearchQuery} />

      <div className={styles.list} data-testid="favourites-list">
        <FavouritesListContent
          connectionId={connectionId}
          searchQuery={searchQuery}
          selectedFavouriteId={selection.selectedFavouriteId}
          onSelect={selection.toggleSelected}
          onDelete={selection.requestDelete}
        />
      </div>

      <ConfirmDialog
        isOpen={selection.pendingDeleteId != null}
        title="Delete favourite"
        message="Are you sure you want to delete this favourite snippet?"
        confirmLabel="Delete"
        isDestructive
        onConfirm={selection.confirmDelete}
        onCancel={selection.cancelDelete}
      />
    </div>
  )
}
