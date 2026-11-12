import { useState, useCallback, useEffect, useMemo } from 'react'
import { useFavoritesStore } from '../../stores/favorites-store'
import type { FavoriteEntry } from '../../types/schema'
import { DialogShell } from '../dialogs/DialogShell'
import { TextInput } from '../common/TextInput'
import { Textarea } from '../common/Textarea'
import { Dropdown } from '../common/Dropdown'
import { Button } from '../common/Button'
import type { DropdownOption } from '../common/Dropdown'
import styles from './FavoriteDialog.module.css'
import { isBlank } from '../../lib/value-checks'

export interface FavoriteDialogProps {
  connectionId: string
}

const SCOPE_OPTIONS: DropdownOption[] = [
  { value: 'connection', label: 'This connection only' },
  { value: 'global', label: 'Global (all connections)' },
]

interface FavoriteFormValues {
  name: string
  sqlText: string
  description: string
  category: string
  scope: 'connection' | 'global'
}

const EMPTY_FAVORITE_FORM: FavoriteFormValues = {
  name: '',
  sqlText: '',
  description: '',
  category: '',
  scope: 'connection',
}

function favoriteFormValues(favorite: FavoriteEntry | null | undefined): FavoriteFormValues {
  if (!favorite) return EMPTY_FAVORITE_FORM
  return {
    name: favorite.name ?? '',
    sqlText: favorite.sqlText ?? '',
    description: favorite.description ?? '',
    category: favorite.category ?? '',
    scope: favorite.connectionId === null ? 'global' : 'connection',
  }
}

function saveButtonLabel(isSaving: boolean, isEditing: boolean): string {
  if (isSaving) return 'Saving...'
  return isEditing ? 'Update' : 'Save'
}

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
    const formValues = favoriteFormValues(editingFavorite)
    setName(formValues.name)
    setSqlText(formValues.sqlText)
    setDescription(formValues.description)
    setCategory(formValues.category)
    setScope(formValues.scope)
  }, [editingFavorite])

  const resolvedConnectionId = useMemo(
    () => (scope === 'global' ? null : connectionId),
    [scope, connectionId]
  )

  const handleSave = useCallback(async () => {
    if (isBlank(name)) return
    if (isBlank(sqlText)) return

    setIsSaving(true)
    try {
      const fields = {
        connectionId: resolvedConnectionId,
        name: name.trim(),
        sqlText: sqlText.trim(),
        description: description.trim() || null,
        category: category.trim() || null,
      }
      const isUpdatingExisting = isEditing && editingFavorite
      await (isUpdatingExisting
        ? updateFavorite(editingFavorite.id, fields)
        : createFavorite(fields))
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
      maxWidth={1040}
      fillMaxWidth
      testId="favorite-dialog"
      ariaLabel={isEditing ? 'Edit favorite' : 'New favorite'}
    >
      <h2 className={styles.title}>{isEditing ? 'Edit favorite' : 'New favorite'}</h2>
      <div className={styles.form}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="favorite-name">
            Name
          </label>
          <TextInput
            id="favorite-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
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
            onChange={(event) => setSqlText(event.target.value)}
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
            onChange={(value) => setScope(value as 'connection' | 'global')}
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
            onChange={(event) => setCategory(event.target.value)}
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
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Description or context..."
            rows={3}
            data-testid="favorite-description-input"
          />
        </div>
        <div className={styles.actions}>
          <Button
            variant="accent"
            onClick={handleSave}
            disabled={isSaving || !name.trim() || !sqlText.trim()}
            data-testid="favorite-dialog-save"
          >
            {saveButtonLabel(isSaving, isEditing)}
          </Button>
          <Button onClick={closeDialog} data-testid="favorite-dialog-cancel">
            Cancel
          </Button>
        </div>
      </div>
    </DialogShell>
  )
}
