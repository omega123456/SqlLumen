import { Gear, MathOperations, Lightning, CalendarBlank, Eye } from '@phosphor-icons/react'
import type { EditableObjectType } from '../../types/schema'
import { Button } from '../common/Button'
import styles from './ObjectEditorToolbar.module.css'

export interface ObjectEditorToolbarProps {
  objectType: EditableObjectType
  objectName: string
  databaseName: string
  mode: 'create' | 'alter'
  isSaving: boolean
  isDirty: boolean
  onSave: () => void
}

export const OBJECT_TYPE_LABELS: Record<EditableObjectType, string> = {
  procedure: 'Stored Procedure',
  function: 'Function',
  trigger: 'Trigger',
  event: 'Event',
  view: 'View',
}

function getObjectTypeIcon(type: EditableObjectType) {
  switch (type) {
    case 'procedure':
      return <Gear size={20} weight="regular" />
    case 'function':
      return <MathOperations size={20} weight="regular" />
    case 'trigger':
      return <Lightning size={20} weight="regular" />
    case 'event':
      return <CalendarBlank size={20} weight="regular" />
    case 'view':
      return <Eye size={20} weight="regular" />
  }
}

export function ObjectEditorToolbar({
  objectType,
  objectName,
  databaseName,
  mode,
  isSaving,
  isDirty,
  onSave,
}: ObjectEditorToolbarProps) {
  const typeLabel = OBJECT_TYPE_LABELS[objectType]
  const titleLabel = mode === 'create' ? `New ${typeLabel}` : `${typeLabel}: ${objectName}`

  return (
    <div className={styles.toolbar} data-testid="object-editor-toolbar">
      <div className={styles.leftSection}>
        <span className={styles.icon} aria-hidden>
          {getObjectTypeIcon(objectType)}
        </span>
        <div className={styles.labelBlock}>
          <span className={styles.title}>{titleLabel}</span>
          <span className={styles.database}>{databaseName}</span>
        </div>
      </div>
      <div className={styles.rightSection}>
        <Button
          variant="primary"
          disabled={!isDirty || isSaving}
          onClick={onSave}
          data-testid="object-editor-save-button"
        >
          {isSaving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
