import { useFkLookup } from '../fk-lookup-context'
import { FkLookupTriggerButton } from '../FkLookupTriggerButton'
import { Button } from '../../common/Button'
import type { CellEditorBaseProps } from './cell-editor-types'
import { nullToggleClassName } from './cell-editor-keys'
import styles from '../grid-cell-editors.module.css'

interface EditorMarkersProps {
  props: CellEditorBaseProps
  isNull: boolean
  onToggleNull: () => void
}

export function EditorMarkers({ props, isNull, onToggleNull }: EditorMarkersProps) {
  const foreignKeyLookup = useFkLookup()
  const { row, foreignKey, onClose } = props
  const fieldName = props.column.key
  return (
    <div className={styles.editorMarkerGroup}>
      {props.isNullable && (
        <Button
          variant="bare"
          className={nullToggleClassName(isNull)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onToggleNull}
          tabIndex={-1}
        >
          NULL
        </Button>
      )}
      {foreignKey && foreignKeyLookup && (
        <FkLookupTriggerButton
          foreignKey={foreignKey}
          columnKey={fieldName}
          currentValue={row[fieldName]}
          rowData={row}
          className={styles.fkTriggerButton}
          onBeforeLookup={() => onClose(true, false)}
        />
      )}
    </div>
  )
}
