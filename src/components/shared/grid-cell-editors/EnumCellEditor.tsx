import { Dropdown } from '../../common/Dropdown'
import { ENUM_NULL_SENTINEL } from '../enum-field-utils'
import type { CellEditorBaseProps } from './cell-editor-types'
import { EditorMarkers } from './EditorMarkers'
import { useEnumCellEditor } from './use-enum-cell-editor'
import { CELL_EDITOR_WRAPPER, EDITOR_FIELD } from '../../../lib/class-names-grid-editor'
import type { DropdownTriggerChrome } from '../../common/dropdown/dropdown-types'

interface EnumCellEditorProps extends CellEditorBaseProps {
  fullOverlay?: boolean
}

interface EnumEditorLayout {
  wrapperClassName: string
  fieldWrapperClassName: string
  dropdownRootClassName: string
  triggerChrome: DropdownTriggerChrome
  dropdownTriggerProps: Record<string, string>
}

const FULL_OVERLAY_ENUM_LAYOUT: EnumEditorLayout = {
  wrapperClassName: 'flex h-full w-full max-w-full min-w-0 flex-auto items-stretch overflow-hidden',
  fieldWrapperClassName: 'h-full w-full max-w-full min-w-0 flex-auto',
  dropdownRootClassName: 'h-full max-w-full min-w-0 flex-auto',
  triggerChrome: 'gridCellOverlay',
  dropdownTriggerProps: { 'data-sqllumen-grid-editor': 'enum-overlay' },
}

const INLINE_ENUM_LAYOUT: EnumEditorLayout = {
  wrapperClassName: CELL_EDITOR_WRAPPER,
  fieldWrapperClassName: EDITOR_FIELD,
  dropdownRootClassName: 'grow shrink basis-0 min-w-0 max-w-full',
  triggerChrome: 'gridCell',
  dropdownTriggerProps: { 'data-sqllumen-grid-editor': 'enum-inline' },
}

export function EnumCellEditor(props: EnumCellEditorProps) {
  const fieldName = props.column.key
  const fullOverlay = props.fullOverlay === true
  const layout = fullOverlay ? FULL_OVERLAY_ENUM_LAYOUT : INLINE_ENUM_LAYOUT
  const { triggerRef, wrapperRef, isNull, value, ...handlers } = useEnumCellEditor(props)

  return (
    <div ref={wrapperRef} className={layout.wrapperClassName}>
      <div className={layout.fieldWrapperClassName}>
        <Dropdown
          ref={triggerRef}
          id={`enum-cell-${fieldName}`}
          ariaLabel={fieldName}
          options={handlers.enumOptions}
          value={isNull ? ENUM_NULL_SENTINEL : value}
          onChange={handlers.handleDropdownChange}
          onTriggerKeyDown={handlers.handleCommitKeys}
          onListKeyDown={handlers.handleCommitKeys}
          focusListOnOpen={fullOverlay}
          onTriggerBlur={fullOverlay ? undefined : handlers.handleTriggerBlur}
          className={layout.dropdownRootClassName}
          triggerChrome={layout.triggerChrome}
          triggerProps={layout.dropdownTriggerProps}
        />
      </div>
      {!fullOverlay && (
        <EditorMarkers props={props} isNull={isNull} onToggleNull={handlers.handleToggleNull} />
      )}
    </div>
  )
}
