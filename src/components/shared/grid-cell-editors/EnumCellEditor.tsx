import { Dropdown } from '../../common/Dropdown'
import { ENUM_NULL_SENTINEL } from '../../table-data/enum-field-utils'
import type { CellEditorBaseProps } from './cell-editor-types'
import { EditorMarkers } from './EditorMarkers'
import { useEnumCellEditor } from './use-enum-cell-editor'
import styles from '../grid-cell-editors.module.css'

interface EnumCellEditorProps extends CellEditorBaseProps {
  fullOverlay?: boolean
}

interface EnumEditorLayout {
  wrapperClassName: string
  fieldWrapperClassName: string
  dropdownRootClassName: string
  dropdownTriggerClassName: string
  dropdownTriggerProps: Record<string, string> | undefined
}

const FULL_OVERLAY_ENUM_LAYOUT: EnumEditorLayout = {
  wrapperClassName: styles.dropdownOnlyWrapper,
  fieldWrapperClassName: styles.editorDropdownRoot,
  dropdownRootClassName: styles.editorDropdownRoot,
  dropdownTriggerClassName: `td-cell-editor-select ${styles.editorDropdownTrigger}`,
  dropdownTriggerProps: { 'data-sqllumen-grid-editor': 'enum-overlay' },
}

const INLINE_ENUM_LAYOUT: EnumEditorLayout = {
  wrapperClassName: styles.cellEditorWrapper,
  fieldWrapperClassName: styles.editorFieldPrimary,
  dropdownRootClassName: styles.editorField,
  dropdownTriggerClassName: `td-cell-editor-select ${styles.editorSelect}`,
  dropdownTriggerProps: undefined,
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
          triggerClassName={layout.dropdownTriggerClassName}
          triggerProps={layout.dropdownTriggerProps}
        />
      </div>
      {!fullOverlay && (
        <EditorMarkers props={props} isNull={isNull} onToggleNull={handlers.handleToggleNull} />
      )}
    </div>
  )
}
