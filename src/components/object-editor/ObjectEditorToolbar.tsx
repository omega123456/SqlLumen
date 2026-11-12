import {
  Gear,
  MathOperations,
  Lightning,
  CalendarBlank,
  Eye,
  type Icon,
} from '@phosphor-icons/react'
import type { EditableObjectType } from '../../types/schema'
import { Button } from '../common/Button'
import { OBJECT_TYPE_LABELS } from './object-editor-constants'
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

const OBJECT_TYPE_ICONS: Record<EditableObjectType, Icon> = {
  procedure: Gear,
  function: MathOperations,
  trigger: Lightning,
  event: CalendarBlank,
  view: Eye,
}

function getObjectTypeIcon(type: EditableObjectType) {
  const ObjectTypeIcon = OBJECT_TYPE_ICONS[type]
  return <ObjectTypeIcon size={20} weight="regular" />
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
          variant="accent"
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
