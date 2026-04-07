import { useCallback, useEffect, useMemo, useState } from 'react'
import { MagnifyingGlass, Plus } from '@phosphor-icons/react'
import { useFavoritesStore } from '../../stores/favorites-store'
import { insertSqlIntoEditor } from '../../lib/query-tab-utils'
import { TextInput } from '../common/TextInput'
import { Button } from '../common/Button'
import { ConfirmDialog } from '../dialogs/ConfirmDialog'
import { FavoriteDialog } from '../history-favorites/FavoriteDialog'
import { FavouritesSnippetCard } from './FavouritesSnippetCard'
import { FavouritesDetailPanel } from './FavouritesDetailPanel'
import type { FavoriteEntry } from '../../types/schema'
import styles from './FavouritesView.module.css'

export interface FavouritesViewProps {
  connectionId: string
}

export function FavouritesView({ connectionId }: FavouritesViewProps) {
  const entries = useFavoritesStore((state) => state.entries)
  const isLoading = useFavoritesStore((state) => state.isLoading)
  const error = useFavoritesStore((state) => state.error)
  const dialogOpen = useFavoritesStore((state) => state.dialogOpen)
  const openDialog = useFavoritesStore((state) => state.openDialog)
  const deleteFavorite = useFavoritesStore((state) => state.deleteFavorite)
  const loadFavorites = useFavoritesStore((state) => state.loadFavorites)

  const [searchQuery, setSearchQuery] = useState('')
  const [selectedFavouriteId, setSelectedFavouriteId] = useState<number | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null)

  // Load favourites on mount
  useEffect(() => {
    void loadFavorites(connectionId)
  }, [connectionId, loadFavorites])

  const filteredFavourites = useMemo(() => {
    if (!searchQuery.trim()) return entries
    const query = searchQuery.toLowerCase()
    return entries.filter(
      (entry) =>
        entry.name.toLowerCase().includes(query) ||
        (entry.description && entry.description.toLowerCase().includes(query))
    )
  }, [entries, searchQuery])

  const handleInsert = useCallback(
    (favourite: FavoriteEntry) => {
      insertSqlIntoEditor(connectionId, favourite.sqlText, favourite.name || 'Favorite Query')
    },
    [connectionId]
  )

  const handleEdit = useCallback(
    (favourite: FavoriteEntry) => {
      openDialog(favourite)
    },
    [openDialog]
  )

  const handleDelete = useCallback((id: number) => {
    setPendingDeleteId(id)
  }, [])

  const handleConfirmDelete = useCallback(() => {
    if (pendingDeleteId == null) return
    void deleteFavorite(pendingDeleteId)
    if (selectedFavouriteId === pendingDeleteId) {
      setSelectedFavouriteId(null)
    }
    setPendingDeleteId(null)
  }, [deleteFavorite, selectedFavouriteId, pendingDeleteId])

  const handleCancelDelete = useCallback(() => {
    setPendingDeleteId(null)
  }, [])

  const handleCreateNew = useCallback(() => {
    openDialog(null)
  }, [openDialog])

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value)
  }, [])

  const handleSelect = useCallback((id: number) => {
    setSelectedFavouriteId((prev) => (prev === id ? null : id))
  }, [])

  function renderListContent() {
    if (error) {
      return (
        <div className={styles.errorState} data-testid="favourites-error">
          <span className={styles.errorMessage}>{error}</span>
          <Button
            variant="ghost"
            onClick={() => void loadFavorites(connectionId)}
            data-testid="favourites-retry"
          >
            Retry
          </Button>
        </div>
      )
    }
    if (isLoading && entries.length === 0) {
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
      <div key={favourite.id}>
        <FavouritesSnippetCard
          favourite={favourite}
          isSelected={selectedFavouriteId === favourite.id}
          onSelect={() => handleSelect(favourite.id)}
          onEdit={() => handleEdit(favourite)}
          onInsert={() => handleInsert(favourite)}
        />
        {selectedFavouriteId === favourite.id && (
          <FavouritesDetailPanel
            favourite={favourite}
            onInsert={() => handleInsert(favourite)}
            onDelete={() => handleDelete(favourite.id)}
          />
        )}
      </div>
    ))
  }

  return (
    <div className={styles.container} data-testid="favourites-view">
      <div className={styles.headerRow}>
        <h2 className={styles.title}>Favourites</h2>
        <Button variant="toolbar" onClick={handleCreateNew} data-testid="favourites-new-snippet">
          <Plus size={14} weight="bold" />
          &nbsp;New Snippet
        </Button>
      </div>

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
          onChange={handleSearchChange}
          data-testid="favourites-search"
          aria-label="Search snippets"
        />
      </div>

      <div className={styles.list} data-testid="favourites-list">
        {renderListContent()}
      </div>

      {dialogOpen && <FavoriteDialog connectionId={connectionId} />}

      <ConfirmDialog
        isOpen={pendingDeleteId != null}
        title="Delete Favourite"
        message="Are you sure you want to delete this favourite snippet?"
        confirmLabel="Delete"
        isDestructive
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />
    </div>
  )
}
