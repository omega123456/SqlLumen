import { useState, useCallback, useEffect, useMemo } from 'react'
import { useFavoritesStore } from '../../stores/favorites-store'
import { DialogShell } from '../dialogs/DialogShell'
import { TextInput } from '../common/TextInput'
import { Textarea } from '../common/Textarea'
import { Dropdown } from '../common/Dropdown'
import { Button } from '../common/Button'
import type { DropdownOption } from '../common/Dropdown'
import styles from './FavoriteDialog.module.css'

export interface FavoriteDialogProps {
  connectionId: string
}

const SCOPE_OPTIONS: DropdownOption[] = [
  { value: 'connection', label: 'This connection only' },
  { value: 'global', label: 'Global (all connections)' },
]

export function FavoriteDialog({ connectionId }: FavoriteDialogProps) {
  const dialogOpen = useFavoritesStore((state) => state.dialogOpen)
  const editingFavorite = useFavoritesStore((state) => state.editingFavorite)
  const closeDialog = useFavoritesStore((state) => state.closeDialog)
  const createFavorite = useFavoritesStore((state) => state.createFavorite)
  const updateFavorite = useFavoritesStore((state) => state.updateFavorite)

  const isEditing = !!editingFavorite?.id

  const [name, setName] = useState('')
  const [sqlText, setSqlText] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [scope, setScope] = useState<'connection' | 'global'>('connection')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (editingFavorite) {
      setName(editingFavorite.name ?? '')
      setSqlText(editingFavorite.sqlText ?? '')
      setDescription(editingFavorite.description ?? '')
      setCategory(editingFavorite.category ?? '')
      setScope(editingFavorite.connectionId === null ? 'global' : 'connection')
    } else {
      setName('')
      setSqlText('')
      setDescription('')
      setCategory('')
      setScope('connection')
    }
  }, [editingFavorite])

  const resolvedConnectionId = useMemo(
    () => (scope === 'global' ? null : connectionId),
    [scope, connectionId]
  )

  const handleSave = useCallback(async () => {
    if (!name.trim() || !sqlText.trim()) return

    setIsSaving(true)
    try {
      if (isEditing && editingFavorite) {
        await updateFavorite(editingFavorite.id, {
          name: name.trim(),
          sqlText: sqlText.trim(),
          description: description.trim() || null,
          category: category.trim() || null,
          connectionId: resolvedConnectionId,
        })
      } else {
        await createFavorite({
          connectionId: resolvedConnectionId,
          name: name.trim(),
          sqlText: sqlText.trim(),
          description: description.trim() || null,
          category: category.trim() || null,
        })
      }
      closeDialog()
    } finally {
      setIsSaving(false)
    }
  }, [
    name,
    sqlText,
    description,
    category,
    resolvedConnectionId,
    isEditing,
    editingFavorite,
    createFavorite,
    updateFavorite,
    closeDialog,
  ])

  return (
    <DialogShell
      isOpen={dialogOpen}
      onClose={closeDialog}
      maxWidth={520}
      testId="favorite-dialog"
      ariaLabel={isEditing ? 'Edit Favorite' : 'New Favorite'}
    >
      <h2 className={styles.title}>{isEditing ? 'Edit Favorite' : 'New Favorite'}</h2>
      <div className={styles.form}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="favorite-name">
            Name
          </label>
          <TextInput
            id="favorite-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My query..."
            data-testid="favorite-name-input"
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="favorite-sql">
            SQL
          </label>
          <Textarea
            id="favorite-sql"
            variant="mono"
            value={sqlText}
            onChange={(e) => setSqlText(e.target.value)}
            placeholder="SELECT * FROM ..."
            rows={6}
            data-testid="favorite-sql-input"
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="favorite-scope">
            Scope
          </label>
          <Dropdown
            id="favorite-scope"
            ariaLabel="Favorite scope"
            options={SCOPE_OPTIONS}
            value={scope}
            onChange={(val) => setScope(val as 'connection' | 'global')}
            data-testid="favorite-scope-dropdown"
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="favorite-category">
            Category (optional)
          </label>
          <TextInput
            id="favorite-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="e.g. Reports, Admin..."
            data-testid="favorite-category-input"
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="favorite-description">
            Description (optional)
          </label>
          <Textarea
            id="favorite-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description or context..."
            rows={3}
            data-testid="favorite-description-input"
          />
        </div>
        <div className={styles.actions}>
          <Button variant="secondary" onClick={closeDialog} data-testid="favorite-dialog-cancel">
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={isSaving || !name.trim() || !sqlText.trim()}
            data-testid="favorite-dialog-save"
          >
            {isSaving ? 'Saving...' : isEditing ? 'Update' : 'Save'}
          </Button>
        </div>
      </div>
    </DialogShell>
  )
}
