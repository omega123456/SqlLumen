import { useState, useCallback, useEffect } from 'react'
import type { ReactNode } from 'react'
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

type FavoriteFormField = keyof FavoriteFormValues

function useFavoriteForm(connectionId: string) {
  const editingFavorite = useFavoritesStore((state) => state.editingFavorite)
  const closeDialog = useFavoritesStore((state) => state.closeDialog)
  const createFavorite = useFavoritesStore((state) => state.createFavorite)
  const updateFavorite = useFavoritesStore((state) => state.updateFavorite)
  const isEditing = !!editingFavorite?.id
  const [formValues, setFormValues] = useState(EMPTY_FAVORITE_FORM)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    setFormValues(favoriteFormValues(editingFavorite))
  }, [editingFavorite])

  const setField = useCallback((field: FavoriteFormField, value: string) => {
    setFormValues((current) => ({ ...current, [field]: value }))
  }, [])

  const handleSave = useCallback(async () => {
    if (isBlank(formValues.name)) return
    if (isBlank(formValues.sqlText)) return

    setIsSaving(true)
    try {
      const fields = {
        connectionId: formValues.scope === 'global' ? null : connectionId,
        name: formValues.name.trim(),
        sqlText: formValues.sqlText.trim(),
        description: formValues.description.trim() || null,
        category: formValues.category.trim() || null,
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
    formValues,
    connectionId,
    isEditing,
    editingFavorite,
    createFavorite,
    updateFavorite,
    closeDialog,
  ])

  return { formValues, setField, isSaving, isEditing, handleSave, closeDialog }
}

interface LabelledFieldProps {
  label: string
  htmlFor: string
  children: ReactNode
}

function LabelledField({ label, htmlFor, children }: LabelledFieldProps) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  )
}

interface FavoriteFormFieldsProps {
  formValues: FavoriteFormValues
  setField: (field: FavoriteFormField, value: string) => void
}

function FavoriteFormFields({ formValues, setField }: FavoriteFormFieldsProps) {
  return (
    <>
      <LabelledField label="Name" htmlFor="favorite-name">
        <TextInput
          id="favorite-name"
          value={formValues.name}
          onChange={(event) => setField('name', event.target.value)}
          placeholder="My query..."
          data-testid="favorite-name-input"
        />
      </LabelledField>
      <LabelledField label="SQL" htmlFor="favorite-sql">
        <Textarea
          id="favorite-sql"
          variant="mono"
          value={formValues.sqlText}
          onChange={(event) => setField('sqlText', event.target.value)}
          placeholder="SELECT * FROM ..."
          rows={6}
          data-testid="favorite-sql-input"
        />
      </LabelledField>
      <LabelledField label="Scope" htmlFor="favorite-scope">
        <Dropdown
          id="favorite-scope"
          ariaLabel="Favorite scope"
          options={SCOPE_OPTIONS}
          value={formValues.scope}
          onChange={(value) => setField('scope', value)}
          data-testid="favorite-scope-dropdown"
        />
      </LabelledField>
      <LabelledField label="Category (optional)" htmlFor="favorite-category">
        <TextInput
          id="favorite-category"
          value={formValues.category}
          onChange={(event) => setField('category', event.target.value)}
          placeholder="e.g. Reports, Admin..."
          data-testid="favorite-category-input"
        />
      </LabelledField>
      <LabelledField label="Description (optional)" htmlFor="favorite-description">
        <Textarea
          id="favorite-description"
          value={formValues.description}
          onChange={(event) => setField('description', event.target.value)}
          placeholder="Description or context..."
          rows={3}
          data-testid="favorite-description-input"
        />
      </LabelledField>
    </>
  )
}

export function FavoriteDialog({ connectionId }: FavoriteDialogProps) {
  const dialogOpen = useFavoritesStore((state) => state.dialogOpen)
  const form = useFavoriteForm(connectionId)
  const title = form.isEditing ? 'Edit favorite' : 'New favorite'
  const isIncomplete = !form.formValues.name.trim() || !form.formValues.sqlText.trim()

  return (
    <DialogShell
      isOpen={dialogOpen}
      onClose={form.closeDialog}
      maxWidth={1040}
      fillMaxWidth
      testId="favorite-dialog"
      ariaLabel={title}
    >
      <h2 className={styles.title}>{title}</h2>
      <div className={styles.form}>
        <FavoriteFormFields formValues={form.formValues} setField={form.setField} />
        <div className={styles.actions}>
          <Button
            variant="accent"
            onClick={form.handleSave}
            disabled={form.isSaving || isIncomplete}
            data-testid="favorite-dialog-save"
          >
            {saveButtonLabel(form.isSaving, form.isEditing)}
          </Button>
          <Button onClick={form.closeDialog} data-testid="favorite-dialog-cancel">
            Cancel
          </Button>
        </div>
      </div>
    </DialogShell>
  )
}
