import { useFkLookup } from '../fk-lookup-context'
import { FkLookupTriggerButton } from '../FkLookupTriggerButton'
import { FOCUS_RING } from '../../../lib/focus-ring'
import { joinClassNames } from '../../../lib/class-names'
import type { CellEditorBaseProps } from './cell-editor-types'
import { EditorMarkerGroup, type EditorMarkerKind } from './EditorMarkerGroup'
import { NullToggleButton } from './NullToggleButton'

interface EditorMarkersProps {
  props: CellEditorBaseProps
  isNull: boolean
  onToggleNull: () => void
  kind?: EditorMarkerKind
}

export function EditorMarkers({
  props,
  isNull,
  onToggleNull,
  kind = 'singleLine',
}: EditorMarkersProps) {
  const foreignKeyLookup = useFkLookup()
  const { row, foreignKey, onClose } = props
  const fieldName = props.column.key
  return (
    <EditorMarkerGroup kind={kind}>
      {props.isNullable && <NullToggleButton isNull={isNull} onClick={onToggleNull} />}
      {foreignKey && foreignKeyLookup && (
        <FkLookupTriggerButton
          foreignKey={foreignKey}
          columnKey={fieldName}
          currentValue={row[fieldName]}
          rowData={row}
          className={joinClassNames([
            'flex size-5 min-w-5 shrink-0 cursor-pointer items-center justify-center self-center rounded-control border bg-transparent p-0 transition-bg-and-border duration-100',
            FOCUS_RING,
            'border-light-stroke-divider text-light-outline hover:border-light-primary hover:bg-light-fill-subtle-hover hover:text-light-primary dark:border-dark-stroke-divider dark:text-dark-outline dark:hover:border-dark-primary dark:hover:bg-dark-fill-subtle-hover dark:hover:text-dark-primary',
          ])}
          onBeforeLookup={() => onClose(true, false)}
        />
      )}
    </EditorMarkerGroup>
  )
}
