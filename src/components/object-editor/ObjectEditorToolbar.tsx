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
    <div
      className="flex shrink-0 items-center justify-between border-b border-b-light-stroke-divider bg-light-surface-container px-3 py-2 dark:border-b-dark-stroke-divider dark:bg-dark-surface-container"
      data-testid="object-editor-toolbar"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="inline-flex shrink-0 items-center justify-center text-light-primary dark:text-dark-primary"
          aria-hidden
        >
          {getObjectTypeIcon(objectType)}
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-body text-size-body font-semibold text-light-on-surface dark:text-dark-on-surface">
            {titleLabel}
          </span>
          <span className="font-body text-size-caption text-light-on-surface-variant dark:text-dark-on-surface-variant">
            {databaseName}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
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
